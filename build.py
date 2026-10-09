import re
import os
d=os.path.dirname(os.path.abspath(__file__))+'/src/'
out=os.path.dirname(os.path.abspath(__file__))+'/index.html'
r=lambda f:open(d+f).read()
css=r('style.css'); core=r('core.js')
app="\n".join(r(f) for f in ['part1.js','part2.js','part3.js','part4.js','part6.js','part5.js'])
html=f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Butterfly PEMF Optimizer</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&family=STIX+Two+Text:ital@0;1&display=swap">
<style>
{css}
</style>
</head><body>
<header class="top"><div><h1>Butterfly PEMF coil optimizer</h1><p>Flux against amps, volts and heat, solved with Lagrange multipliers. Change anything on the left; the optimum, every chart and every equation update together.</p></div><div id="status"></div></header>
<div class="shell">
<aside id="problem" class="problem" aria-label="Problem inputs"></aside>
<main class="main">
<div class="readout" id="readout"><div class="rohead"><div class="seg" id="modeSeg" role="group" aria-label="Mode shown"><button type="button" data-m="a" aria-pressed="true">Acute</button><button type="button" data-m="r" aria-pressed="false">Recovery</button></div><div id="limitedby" aria-live="polite"></div></div><div class="kpis" id="kpis"></div></div>
<nav class="tabs" id="tabs" role="tablist" aria-label="Views"></nav>
<div id="panels"></div>
</main>
</div>
<nav class="pswitch" id="pswitch" aria-label="Switch panel"><button type="button" data-p="views" aria-pressed="true">Results</button><button type="button" data-p="problem" aria-pressed="false">Problem inputs</button></nav>
<script id="core">
{core}
</script>
<script>
(function(){{'use strict';
{app}
}})();
</script>
</body></html>
'''
assert '</script' not in core and '</script' not in app
open(out,'w').write(html)
print(len(html))
