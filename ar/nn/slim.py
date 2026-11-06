# Slim a WebAR.rocks.train save into the network a web page loads: drop what only training uses (its learning
# curves, the training script, timings) and keep every number at 4 significant digits (a relative error of 5e-5,
# far below what the network can tell apart). Same JSON format; GitHub Pages sends it gzipped.
#   python3 slim.py <training save>.json <out>.json
import json, sys

src, dst = sys.argv[1], sys.argv[2]
net = json.load(open(src, encoding='utf-8'))
keep = {k: net[k] for k in ('type', 'layers', 'exportData', 'trainerApp', 'trainerVersion') if k in net}
info = net.get('trainingInfos') or {}
curves = info.get('learningCurves') or {}
keep['slim'] = {'from': src.replace('\\', '/').split('/')[-1], 'minibatches': info.get('minibatchsCount'),
                'lastTestError': (curves.get('errors') or [None])[-1], 'significantDigits': 4}

def rnd(o):
    if isinstance(o, float): return float('%.4g' % o)
    if isinstance(o, list): return [rnd(x) for x in o]
    if isinstance(o, dict): return {k: rnd(v) for k, v in o.items()}
    return o

json.dump(rnd(keep), open(dst, 'w', encoding='utf-8'), separators=(',', ':'))
