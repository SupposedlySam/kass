# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files
from PyInstaller.utils.hooks import collect_dynamic_libs
from PyInstaller.utils.hooks import collect_submodules
from PyInstaller.utils.hooks import collect_all
from PyInstaller.utils.hooks import copy_metadata

datas = [('assets/silero_vad.onnx', 'backend/assets')]
binaries = []
hiddenimports = ['backend', 'backend.main', 'backend.config', 'backend.database', 'backend.models', 'backend.services.transcribe', 'backend.utils.platform_detect', 'backend.backends', 'backend.backends.qwen_llm_backend', 'backend.utils.audio', 'backend.utils.progress', 'backend.utils.hf_progress', 'transformers', 'fastapi', 'uvicorn', 'uvicorn.protocols.websockets.auto', 'uvicorn.protocols.websockets.websockets_impl', 'sqlalchemy', 'soundfile', 'onnxruntime', 'requests', 'pkg_resources.extern', 'backend.backends.mlx_backend', 'mlx', 'mlx.core', 'mlx.nn', 'mlx_audio', 'mlx_audio.stt', 'mlx_lm', 'backend.backends.kokoro_backend']
datas += collect_data_files('language_tags')
datas += collect_data_files('babel')
datas += collect_data_files('pytz')
datas += collect_data_files('dateutil')
datas += collect_data_files('jsonschema_specifications')
datas += collect_data_files('rdflib')
datas += collect_data_files('csvw')
datas += collect_data_files('segments')
datas += copy_metadata('requests')
datas += copy_metadata('transformers')
datas += copy_metadata('huggingface-hub')
datas += copy_metadata('tokenizers')
datas += copy_metadata('safetensors')
datas += copy_metadata('tqdm')
datas += copy_metadata('spacy')
datas += copy_metadata('spacy-legacy')
datas += copy_metadata('spacy-loggers')
datas += copy_metadata('thinc')
datas += copy_metadata('en_core_web_sm')
datas += copy_metadata('misaki')
datas += copy_metadata('phonemizer-fork')
datas += copy_metadata('csvw')
datas += copy_metadata('segments')
datas += copy_metadata('rdflib')
datas += copy_metadata('jsonschema')
datas += copy_metadata('language-tags')
binaries += collect_dynamic_libs('onnxruntime')
hiddenimports += collect_submodules('backend.services')
hiddenimports += collect_submodules('websockets')
hiddenimports += collect_submodules('jaraco')
hiddenimports += collect_submodules('mlx')
hiddenimports += collect_submodules('mlx_audio')
hiddenimports += collect_submodules('mlx_lm')
tmp_ret = collect_all('lazy_loader')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('librosa')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('mlx')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('mlx_audio')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('mlx_lm')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('misaki')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('spacy')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('spacy_legacy')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('spacy_loggers')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('en_core_web_sm')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('espeakng_loader')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('phonemizer')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('num2words')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=['pyi_hooks'],
    hooksconfig={},
    runtime_hooks=['pyi_rth_scipy_distn.py'],
    excludes=['torch', 'torchaudio', 'torchvision'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='kass-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='kass-server',
)
