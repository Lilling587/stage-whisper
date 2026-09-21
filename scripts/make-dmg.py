#!/usr/bin/env python3
"""Bygger en HFS+-baserad .dmg av en Mac-app utan macOS."""
import os, subprocess, sys, math

HFS = "/tmp/libdmg/hfs/hfsplus"
DMG = "/tmp/libdmg/dmg/dmg"
MKFS = "/nix/store/yrr8zsy664k3bpvj7gvwn8wa8ccffj21-hfsprogs-627.40.1-linux/bin/mkfs.hfsplus"

src_root, app_name, img, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

def run(*args):
    r = subprocess.run([HFS, img, *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"fel: {args} -> {r.stdout} {r.stderr}")

# storleksberäkning
total = 0
for d, _, files in os.walk(src_root):
    for f in files:
        p = os.path.join(d, f)
        if not os.path.islink(p):
            total += os.path.getsize(p)
size_mb = int(total / 1024 / 1024 * 1.12) + 120
subprocess.run(["truncate", "-s", f"{size_mb}M", img], check=True)
subprocess.run([MKFS, "-v", "Intercomtext", img], check=True, capture_output=True)

app_src = os.path.join(src_root, app_name)
run("mkdir", "/" + app_name)
run("symlink", "/Applications", "/Applications")

count = 0
for d, dirs, files in os.walk(app_src):
    rel = os.path.relpath(d, app_src)
    base = "/" + app_name if rel == "." else "/" + app_name + "/" + rel.replace(os.sep, "/")
    # symlänkade kataloger dyker upp i dirs -> hantera dem som länkar
    for name in list(dirs):
        p = os.path.join(d, name)
        if os.path.islink(p):
            dirs.remove(name)
            run("symlink", f"{base}/{name}", os.readlink(p))
            continue
        run("mkdir", f"{base}/{name}")
        run("chmod", oct(os.lstat(p).st_mode & 0o7777)[2:], f"{base}/{name}")
    for name in files:
        p = os.path.join(d, name)
        dest = f"{base}/{name}"
        if os.path.islink(p):
            run("symlink", dest, os.readlink(p))
        else:
            run("add", p, dest)
            run("chmod", oct(os.lstat(p).st_mode & 0o7777)[2:], dest)
        count += 1
        if count % 100 == 0:
            print(f"{count} filer", flush=True)

print("bygger dmg", flush=True)
r = subprocess.run([DMG, "build", img, out], capture_output=True, text=True)
if r.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) == 0:
    raise SystemExit("dmg build misslyckades: " + r.stdout[-500:] + r.stderr[-500:])
print("klar", out, os.path.getsize(out), flush=True)
