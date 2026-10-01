import 'package:hooksman/hooksman.dart';

import 'tasks/pushed_files.dart';

/// Lints and formats the files a push changes, and nothing else.
///
/// Register once per clone with `dart run hooksman register` (`just setup`
/// does it). Skip once with `SKIP=1 git push`.
Hook main() {
  // Verbose until hooksman shows a task's output in normal mode: 3.3.0 sets
  // its logger to errors only and then flushes task output at info level,
  // so a stopped push would say nothing about why.
  return PrePushHook.verbose(
    // A failed push keeps its fixes in the working tree to be committed.
    backup: false,
    tasks: [LintPushedFiles()],
  );
}
