import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:hooksman/hooksman.dart';

const _noCommit = '0000000000000000000000000000000000000000';

const _biomeExtensions = {
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', //
  '.json', '.jsonc', '.css', '.html',
};

/// The files the refs on `pre-push`'s stdin add or change.
///
/// Git writes one line per ref: `<local ref> <local sha> <remote ref> <remote sha>`.
/// Each pushed range starts at the remote's commit, or, for a branch the
/// remote doesn't have yet, where the branch left the remote's default branch.
/// Only files that still exist are returned, since the tools read the
/// working tree.
Future<List<String>> pushedFiles(String stdin) async {
  final files = <String>{};
  for (final line in const LineSplitter().convert(stdin)) {
    final parts = line.trim().split(RegExp(r'\s+'));
    if (parts.length != 4) continue;
    final [_, localSha, _, remoteSha] = parts;
    // Deleting a remote branch pushes no files.
    if (localSha == _noCommit) continue;

    final base =
        remoteSha != _noCommit &&
            await _git(['cat-file', '-e', '$remoteSha^{commit}']) != null
        ? remoteSha
        : await _forkPoint(localSha);
    final range = base == null ? [localSha] : [base, localSha];
    final changed = await _git([
      if (base == null) ...['show', '--pretty=format:'] else 'diff',
      '--name-only',
      '--diff-filter=ACMR',
      ...range,
    ]);
    files.addAll(
      const LineSplitter()
          .convert(changed ?? '')
          .where((path) => path.isNotEmpty),
    );
  }
  return [
    for (final path in files.toList()..sort())
      if (File(path).existsSync()) path,
  ];
}

/// Where [sha] left the remote's default branch, or null without a remote.
Future<String?> _forkPoint(String sha) async {
  for (final branch in [
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/main',
  ]) {
    final base = await _git(['merge-base', sha, branch]);
    if (base != null) return base.trim();
  }
  return null;
}

/// stdout of `git args`, or null when it fails.
Future<String?> _git(List<String> args) async {
  final result = await Process.run('git', args);
  return result.exitCode == 0 ? result.stdout as String : null;
}

String _extension(String path) {
  final dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.substring(dot);
}

/// Lints and formats the pushed files, fixing what the tools can fix.
///
/// A push that needed fixes is stopped with the fixed files listed, since a
/// hook can't change commits that are already made. One that only has
/// problems no tool fixes is stopped with the tools' output.
class LintPushedFiles extends HookTask {
  LintPushedFiles() : super.always();

  @override
  String get name => 'Lint and format pushed files';

  @override
  Future<int> run(
    List<String> filePaths, {
    required void Function(String?) print,
    required void Function(HookTask, int) completeTask,
    required void Function(HookTask) startTask,
    required String? workingDirectory,
  }) async {
    startTask(this);
    final result = await _run(print);
    completeTask(this, result);
    return result;
  }

  Future<int> _run(void Function(String?) print) async {
    final files = await pushedFiles(hookContext.stdin);
    final python = [
      for (final path in files)
        if (path.startsWith('backend/') && _extension(path) == '.py') path,
    ];
    final web = [
      for (final path in files)
        if (_biomeExtensions.contains(_extension(path))) path,
    ];
    final dart = [
      for (final path in files)
        if (_extension(path) == '.dart') path,
    ];
    if (python.isEmpty && web.isEmpty && dart.isEmpty) return 0;

    final checked = [...python, ...web, ...dart];
    final before = {for (final path in checked) path: _digest(path)};

    // Fix first, so a push only fails on what no tool fixes.
    final ruff = 'backend/venv/bin/ruff';
    const biome = 'node_modules/.bin/biome';
    const biomeFlags = [
      '--files-ignore-unknown=true',
      '--no-errors-on-unmatched',
    ];
    final failures = <String>[];
    Future<void> step(String label, String command, List<String> args) async {
      final result = await Process.run(command, args);
      if (result.exitCode != 0) {
        failures.add('$label failed:\n${result.stdout}${result.stderr}'.trim());
      }
    }

    if (python.isNotEmpty) {
      await step('ruff check --fix', ruff, [
        'check',
        '--fix',
        '--quiet',
        ...python,
      ]);
      await step('ruff format', ruff, ['format', '--quiet', ...python]);
    }
    if (web.isNotEmpty) {
      await step('biome check --write', biome, [
        'check',
        '--write',
        ...biomeFlags,
        ...web,
      ]);
    }
    if (dart.isNotEmpty) {
      await step('dart format', 'dart', ['format', ...dart]);
    }

    final fixed = [
      for (final path in checked)
        if (_digest(path) != before[path]) path,
    ];
    if (fixed.isNotEmpty) {
      print('Fixed lint and formatting in files this push changes:');
      for (final path in fixed) {
        print('  $path');
      }
      print('Commit them and push again.');
      return 1;
    }

    // Whatever the fixers left behind, and the type checks, which read whole packages.
    failures.clear();
    if (python.isNotEmpty) {
      await step('ruff check', ruff, ['check', ...python]);
      await step('ruff format --check', ruff, ['format', '--check', ...python]);
    }
    if (web.isNotEmpty) {
      await step('biome check', biome, ['check', ...biomeFlags, ...web]);
    }
    if (dart.isNotEmpty) {
      await step('dart analyze', 'dart', ['analyze', '--fatal-infos', ...dart]);
    }
    for (final package in ['app', 'tauri']) {
      if (web.any(
        (path) => path.startsWith('$package/') || path.startsWith('app/src/'),
      )) {
        await step('tsc ($package)', 'node_modules/.bin/tsc', [
          '-p',
          '$package/tsconfig.json',
          '--noEmit',
        ]);
      }
    }
    if (failures.isEmpty) return 0;
    failures.forEach(print);
    return 1;
  }

  String? _digest(String path) {
    final file = File(path);
    return file.existsSync()
        ? md5.convert(file.readAsBytesSync()).toString()
        : null;
  }
}
