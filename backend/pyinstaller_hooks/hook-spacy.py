"""spaCy's data and submodules, as pyinstaller-hooks-contrib's hook collects
them, without the test suite spaCy ships inside the package."""

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

datas = collect_data_files("spacy", excludes=["tests"])
hiddenimports = collect_submodules("spacy", filter=lambda name: ".tests" not in name)
