#!/bin/bash
# Collect Kass's logs, crash reports and system info into one zip to send
# for debugging. Nothing is uploaded: the zip is written locally and its path
# is the last line printed.
#
# Ships in the app (Kass.app/Contents/Resources/kass-report.sh), so it works
# with Kass quit or crashed:
#
#   bash /Applications/Kass.app/Contents/Resources/kass-report.sh
#
# Options:
#   --output DIR   where to write the zip (default: ~/Downloads)
#   --days N       crash reports from the last N days (default: 14)
#
# KASS_DATA_DIR overrides the data directory (tests use it).
#
# Never collected: the database (captures and their text), recorded audio,
# the dictionary, writing styles, correction notes and voice training data.
# Home paths, the user name and the computer name are redacted from every file.

set -euo pipefail

output_dir="$HOME/Downloads"
days=14
while [ $# -gt 0 ]; do
  case "$1" in
    --output) output_dir="$2"; shift 2 ;;
    --days) days="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$days" in ''|*[!0-9]*) echo "--days takes a whole number" >&2; exit 2 ;; esac

data_dir="${KASS_DATA_DIR:-$HOME/Library/Application Support/com.mrgnhnt.kass}"
stamp=$(date +%Y-%m-%d-%H%M%S)
name="Kass-report-$stamp"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
report="$work/$name"
mkdir -p "$report/logs" "$report/crashes"

user_name=$(id -un)
computer_names=$(
  {
    scutil --get ComputerName 2>/dev/null || true
    scutil --get LocalHostName 2>/dev/null || true
  } | sort -u | grep -E '.{4,}' || true
)

# Copy $1 to $2 with home paths, the user name and computer names taken out.
# Names match literally (escaped before they reach sed) and as whole words.
escape() { printf '%s' "$1" | sed 's/[][\\/.^$*+?(){}|]/\\&/g'; }
whole_word() { printf 's/(^|[^[:alnum:]])%s([^[:alnum:]]|$)/\\1%s\\2/g' "$(escape "$1")" "$2"; }
redact() {
  local script
  script="s/$(escape "$HOME")/~/g;s#/Users/[^/ \"']*#/Users/<user>#g"
  # Values a failed database write or a rejected request logged, which can
  # hold dictated text (older servers logged them).
  script="$script;s/\[parameters: .*/[parameters: <removed>]/;s/input_value=.*/input_value=<removed>/"
  if [ ${#user_name} -ge 3 ]; then
    script="$script;$(whole_word "$user_name" '<user>')"
  fi
  while IFS= read -r computer; do
    [ -n "$computer" ] && script="$script;$(whole_word "$computer" '<computer>')"
  done <<< "$computer_names"
  LC_ALL=C sed -E "$script" "$1" > "$2"
}
redacted_name() {
  local out="$1"
  out="${out//$user_name/user}"
  while IFS= read -r computer; do
    [ -n "$computer" ] && out="${out//$computer/computer}"
  done <<< "$computer_names"
  printf '%s' "$out"
}

# Logs: the server's (and its rotations), the watchdog's, the app console's.
if [ -d "$data_dir/logs" ]; then
  for file in "$data_dir/logs"/*.log "$data_dir/logs"/*.log.[0-9]*; do
    [ -f "$file" ] && redact "$file" "$report/logs/$(basename "$file")"
  done
fi

# Crash reports macOS wrote for Kass, and memory-pressure kills naming it.
crash_count=0
for dir in "$HOME/Library/Logs/DiagnosticReports" /Library/Logs/DiagnosticReports; do
  [ -d "$dir" ] || continue
  while IFS= read -r -d '' file; do
    base=$(basename "$file")
    case "$base" in
      kass*|Kass*) ;;
      JetsamEvent*) grep -qi 'kass' "$file" 2>/dev/null || continue ;;
      *) continue ;;
    esac
    redact "$file" "$report/crashes/$(redacted_name "$base")"
    crash_count=$((crash_count + 1))
  done < <(find "$dir" -maxdepth 2 -type f -mtime "-$days" -print0 2>/dev/null)
done

# System and app state.
app=/Applications/Kass.app
plist_value() { /usr/libexec/PlistBuddy -c "Print :$1" "$app/Contents/Info.plist" 2>/dev/null || echo unknown; }
section() { printf '\n== %s ==\n' "$1"; }
{
  echo "Kass report $stamp"
  section "Kass"
  if [ -d "$app" ]; then
    echo "version: $(plist_value CFBundleShortVersionString) (build $(plist_value CFBundleVersion))"
  else
    echo "version: not installed in /Applications"
  fi
  echo "update channel: $(cat "$data_dir/update-channel" 2>/dev/null || echo default)"
  section "Mac"
  sw_vers 2>/dev/null || true
  echo "chip: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)"
  echo "memory: $(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 )) GB"
  echo "uptime:$(uptime | sed 's/.*up/ up/')"
  section "Memory"
  sysctl vm.swapusage 2>/dev/null || true
  memory_pressure -Q 2>/dev/null | tail -1 || true
  vm_stat 2>/dev/null || true
  section "Disk"
  df -h "$HOME" 2>/dev/null || true
  section "Kass processes"
  # Matched on the executable alone: other command lines can mention Kass.
  ps -axo pid,ppid,rss,%cpu,etime,comm 2>/dev/null |
    awk 'NR == 1 || $6 ~ /Kass\.app\/|\/kass-server$|\/target\/(debug|release)\/kass$/' || true
  section "Settings"
  db="$data_dir/kass.db"
  # Model and feature choices only, never text the user wrote or said.
  allowed="stt_model language auto_refine llm_model command_llm_model smart_cleanup self_correction
    preserve_technical punctuation_style allow_auto_paste hotkey_enabled keep_mic_warm live_text
    sound_cues voice_edits expressive shared_adapters discard_audio history_retention_days
    onboarding_completed share_usage"
  if [ -f "$db" ] && command -v sqlite3 >/dev/null; then
    columns=$(sqlite3 "file:$db?mode=ro" "SELECT name FROM pragma_table_info('capture_settings')" 2>/dev/null || true)
    picked=""
    for column in $allowed; do
      grep -qx "$column" <<< "$columns" && picked="${picked:+$picked, }$column"
    done
    if [ -n "$picked" ]; then
      sqlite3 -line "file:$db?mode=ro" "SELECT $picked FROM capture_settings LIMIT 1" 2>/dev/null || echo "unreadable"
    else
      echo "unavailable"
    fi
  else
    echo "unavailable"
  fi
  section "Data directory"
  if [ -d "$data_dir" ]; then
    du -sh "$data_dir"/* 2>/dev/null | sed "s#$(escape "$data_dir")/##" || true
  else
    echo "missing"
  fi
} > "$work/system.raw" 2>&1
redact "$work/system.raw" "$report/system.txt"

cat > "$report/README.txt" <<EOF
Kass report, made $stamp.

  system.txt  Kass version, macOS, chip, memory and swap, Kass's processes,
              model and feature settings, data directory sizes
  logs/       Kass's log files
  crashes/    crash reports macOS wrote for Kass in the last $days days ($crash_count)

Not included: your captures and their text, recorded audio, your dictionary,
writing styles, correction notes or voice training data. Home paths, your user
name and your computer's name are replaced with <user> and <computer>.
EOF

mkdir -p "$output_dir"
zip_path="$output_dir/$name.zip"
(cd "$work" && zip -qr -X "$zip_path" "$name")
echo "$zip_path"
