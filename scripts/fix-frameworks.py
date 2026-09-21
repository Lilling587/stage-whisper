import os, shutil, sys
root = sys.argv[1]
for d, dirs, files in os.walk(root):
    for name in list(dirs):
        if not name.endswith('.framework'): continue
        fw = os.path.join(d, name)
        va = os.path.join(fw, 'Versions', 'A')
        if not os.path.isdir(va): continue
        cur = os.path.join(fw, 'Versions', 'Current')
        if os.path.isdir(cur) and not os.path.islink(cur):
            shutil.rmtree(cur)
        if not os.path.exists(cur):
            os.symlink('A', cur)
        for e in os.listdir(va):
            top = os.path.join(fw, e)
            if os.path.islink(top): continue
            if os.path.isdir(top): shutil.rmtree(top)
            elif os.path.exists(top): os.remove(top)
            os.symlink(os.path.join('Versions', 'Current', e), top)
            print('länkade', top)
