import{$ as e,I as t,N as n,P as r,S as i,U as a,W as o,f as s,h as c,k as l,nt as u,ot as d,p as f,rt as p,x as m}from"./source-Dyp3LtpD.js";import{t as h}from"./download-D1VTTY0Q.js";import{t as g}from"./html-escape-BSkDt_7I.js";import{n as _,r as ee,t as v}from"./lib-sU-9TW2-.js";import{t as y}from"./lib-BLsPj_QT.js";import{t as b}from"./mhchem-ImmVumJT.js";var x=`/* matrx-katex@0.18.9 */`,S=`/* matrx-katex@0.18.9 */@font-face{font-display:block;font-family:KaTeX_AMS;font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_AMS-Regular.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_AMS-Regular.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_AMS-Regular.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Caligraphic;font-style:normal;font-weight:700;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Caligraphic-Bold.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Caligraphic-Bold.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Caligraphic-Bold.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Caligraphic;font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Caligraphic-Regular.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Caligraphic-Regular.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Caligraphic-Regular.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Fraktur;font-style:normal;font-weight:700;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Fraktur-Bold.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Fraktur-Bold.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Fraktur-Bold.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Fraktur;font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Fraktur-Regular.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Fraktur-Regular.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Fraktur-Regular.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Main;font-style:normal;font-weight:700;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-Bold.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-Bold.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-Bold.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Main;font-style:italic;font-weight:700;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-BoldItalic.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-BoldItalic.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-BoldItalic.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Main;font-style:italic;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-Italic.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-Italic.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-Italic.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Main;font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-Regular.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Main-Regular.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Math;font-style:italic;font-weight:700;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Math-BoldItalic.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Math-BoldItalic.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Math-BoldItalic.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Math;font-style:italic;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Math-Italic.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Math-Italic.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Math-Italic.ttf) format("truetype")}@font-face{font-display:block;font-family:"KaTeX_SansSerif";font-style:normal;font-weight:700;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_SansSerif-Bold.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_SansSerif-Bold.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_SansSerif-Bold.ttf) format("truetype")}@font-face{font-display:block;font-family:"KaTeX_SansSerif";font-style:italic;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_SansSerif-Italic.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_SansSerif-Italic.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_SansSerif-Italic.ttf) format("truetype")}@font-face{font-display:block;font-family:"KaTeX_SansSerif";font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_SansSerif-Regular.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_SansSerif-Regular.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_SansSerif-Regular.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Script;font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Script-Regular.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Script-Regular.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Script-Regular.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Size1;font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size1-Regular.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size1-Regular.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size1-Regular.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Size2;font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size2-Regular.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size2-Regular.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size2-Regular.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Size3;font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size3-Regular.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size3-Regular.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size3-Regular.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Size4;font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size4-Regular.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size4-Regular.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Size4-Regular.ttf) format("truetype")}@font-face{font-display:block;font-family:KaTeX_Typewriter;font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Typewriter-Regular.woff2) format("woff2"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Typewriter-Regular.woff) format("woff"),url(https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/fonts/KaTeX_Typewriter-Regular.ttf) format("truetype")}.katex{font:normal 1.21em KaTeX_Main,Times New Roman,serif;line-height:1.2;position:relative;text-indent:0;text-rendering:auto}.katex *{-ms-high-contrast-adjust:none!important;border-color:currentColor}.katex .katex-version:after{content:"0.18.9"}.katex .katex-mathml{border:0;-webkit-clip-path:inset(50%);clip-path:inset(50%);height:1px;overflow:hidden;padding:0;position:absolute;width:1px}.katex .katex-html>.katex-newline{display:block}.katex .katex-base{position:relative;white-space:nowrap;width:-webkit-min-content;width:-moz-min-content;width:min-content}.katex .katex-base,.katex .katex-strut{display:inline-block}.katex .textbf{font-weight:700}.katex .textit{font-style:italic}.katex .textrm{font-family:KaTeX_Main}.katex .textsf{font-family:KaTeX_SansSerif}.katex .texttt{font-family:KaTeX_Typewriter}.katex .mathnormal{font-family:KaTeX_Math;font-style:italic}.katex .mathit{font-family:KaTeX_Main;font-style:italic}.katex .mathrm{font-style:normal}.katex .mathbf{font-family:KaTeX_Main;font-weight:700}.katex .boldsymbol{font-family:KaTeX_Math;font-style:italic;font-weight:700}.katex .amsrm,.katex .mathbb,.katex .textbb{font-family:KaTeX_AMS}.katex .mathcal{font-family:KaTeX_Caligraphic}.katex .mathfrak,.katex .textfrak{font-family:KaTeX_Fraktur}.katex .mathboldfrak,.katex .textboldfrak{font-family:KaTeX_Fraktur;font-weight:700}.katex .mathtt{font-family:KaTeX_Typewriter}.katex .mathscr,.katex .textscr{font-family:KaTeX_Script}.katex .mathsf,.katex .textsf{font-family:KaTeX_SansSerif}.katex .mathboldsf,.katex .textboldsf{font-family:KaTeX_SansSerif;font-weight:700}.katex .mathitsf,.katex .mathsfit,.katex .textitsf{font-family:KaTeX_SansSerif;font-style:italic}.katex .mainrm{font-family:KaTeX_Main;font-style:normal}.katex .vlist-t{border-collapse:collapse;display:inline-table;table-layout:fixed}.katex .vlist-r{display:table-row}.katex .vlist{display:table-cell;position:relative;vertical-align:bottom}.katex .vlist>span{display:block;height:0;position:relative}.katex .vlist>span>span{display:inline-block}.katex .vlist>span>.pstrut{overflow:hidden;width:0}.katex .vlist-t2{margin-right:-2px}.katex .vlist-s{display:table-cell;font-size:1px;min-width:2px;vertical-align:bottom;width:2px}.katex .katex-vbox{align-items:baseline;display:inline-flex;flex-direction:column}.katex .katex-thinbox{display:inline-flex;flex-direction:row;max-width:0;width:0}.katex .msupsub{text-align:left}.katex .mfrac>span>span{text-align:center}.katex .mfrac .frac-line{border-bottom-style:solid;display:inline-block;width:100%}.katex .katex-hdashline,.katex .katex-hline,.katex .katex-overline .overline-line,.katex .katex-rule,.katex .katex-underline .underline-line,.katex .mfrac .frac-line{min-height:1px}.katex .mspace{display:inline-block}.katex .katex-smash{display:inline;line-height:0}.katex .clap,.katex .llap,.katex .rlap{position:relative;width:0}.katex .clap>.katex-inner,.katex .llap>.katex-inner,.katex .rlap>.katex-inner{position:absolute}.katex .clap>.katex-fix,.katex .llap>.katex-fix,.katex .rlap>.katex-fix{display:inline-block}.katex .llap>.katex-inner{right:0}.katex .clap>.katex-inner,.katex .rlap>.katex-inner{left:0}.katex .clap>.katex-inner>span{margin-left:-50%;margin-right:50%}.katex .katex-rule{border:0 solid;display:inline-block;position:relative}.katex .katex-hline,.katex .katex-overline .overline-line,.katex .katex-underline .underline-line{border-bottom-style:solid;display:inline-block;width:100%}.katex .katex-hdashline{border-bottom-style:dashed;display:inline-block;width:100%}.katex .sqrt>.katex-root{margin-left:.2777777778em;margin-right:-.5555555556em}.katex .fontsize-ensurer.reset-size1.size1,.katex .katex-sizing.reset-size1.size1{font-size:1em}.katex .fontsize-ensurer.reset-size1.size2,.katex .katex-sizing.reset-size1.size2{font-size:1.2em}.katex .fontsize-ensurer.reset-size1.size3,.katex .katex-sizing.reset-size1.size3{font-size:1.4em}.katex .fontsize-ensurer.reset-size1.size4,.katex .katex-sizing.reset-size1.size4{font-size:1.6em}.katex .fontsize-ensurer.reset-size1.size5,.katex .katex-sizing.reset-size1.size5{font-size:1.8em}.katex .fontsize-ensurer.reset-size1.size6,.katex .katex-sizing.reset-size1.size6{font-size:2em}.katex .fontsize-ensurer.reset-size1.size7,.katex .katex-sizing.reset-size1.size7{font-size:2.4em}.katex .fontsize-ensurer.reset-size1.size8,.katex .katex-sizing.reset-size1.size8{font-size:2.88em}.katex .fontsize-ensurer.reset-size1.size9,.katex .katex-sizing.reset-size1.size9{font-size:3.456em}.katex .fontsize-ensurer.reset-size1.size10,.katex .katex-sizing.reset-size1.size10{font-size:4.148em}.katex .fontsize-ensurer.reset-size1.size11,.katex .katex-sizing.reset-size1.size11{font-size:4.976em}.katex .fontsize-ensurer.reset-size2.size1,.katex .katex-sizing.reset-size2.size1{font-size:.8333333333em}.katex .fontsize-ensurer.reset-size2.size2,.katex .katex-sizing.reset-size2.size2{font-size:1em}.katex .fontsize-ensurer.reset-size2.size3,.katex .katex-sizing.reset-size2.size3{font-size:1.1666666667em}.katex .fontsize-ensurer.reset-size2.size4,.katex .katex-sizing.reset-size2.size4{font-size:1.3333333333em}.katex .fontsize-ensurer.reset-size2.size5,.katex .katex-sizing.reset-size2.size5{font-size:1.5em}.katex .fontsize-ensurer.reset-size2.size6,.katex .katex-sizing.reset-size2.size6{font-size:1.6666666667em}.katex .fontsize-ensurer.reset-size2.size7,.katex .katex-sizing.reset-size2.size7{font-size:2em}.katex .fontsize-ensurer.reset-size2.size8,.katex .katex-sizing.reset-size2.size8{font-size:2.4em}.katex .fontsize-ensurer.reset-size2.size9,.katex .katex-sizing.reset-size2.size9{font-size:2.88em}.katex .fontsize-ensurer.reset-size2.size10,.katex .katex-sizing.reset-size2.size10{font-size:3.4566666667em}.katex .fontsize-ensurer.reset-size2.size11,.katex .katex-sizing.reset-size2.size11{font-size:4.1466666667em}.katex .fontsize-ensurer.reset-size3.size1,.katex .katex-sizing.reset-size3.size1{font-size:.7142857143em}.katex .fontsize-ensurer.reset-size3.size2,.katex .katex-sizing.reset-size3.size2{font-size:.8571428571em}.katex .fontsize-ensurer.reset-size3.size3,.katex .katex-sizing.reset-size3.size3{font-size:1em}.katex .fontsize-ensurer.reset-size3.size4,.katex .katex-sizing.reset-size3.size4{font-size:1.1428571429em}.katex .fontsize-ensurer.reset-size3.size5,.katex .katex-sizing.reset-size3.size5{font-size:1.2857142857em}.katex .fontsize-ensurer.reset-size3.size6,.katex .katex-sizing.reset-size3.size6{font-size:1.4285714286em}.katex .fontsize-ensurer.reset-size3.size7,.katex .katex-sizing.reset-size3.size7{font-size:1.7142857143em}.katex .fontsize-ensurer.reset-size3.size8,.katex .katex-sizing.reset-size3.size8{font-size:2.0571428571em}.katex .fontsize-ensurer.reset-size3.size9,.katex .katex-sizing.reset-size3.size9{font-size:2.4685714286em}.katex .fontsize-ensurer.reset-size3.size10,.katex .katex-sizing.reset-size3.size10{font-size:2.9628571429em}.katex .fontsize-ensurer.reset-size3.size11,.katex .katex-sizing.reset-size3.size11{font-size:3.5542857143em}.katex .fontsize-ensurer.reset-size4.size1,.katex .katex-sizing.reset-size4.size1{font-size:.625em}.katex .fontsize-ensurer.reset-size4.size2,.katex .katex-sizing.reset-size4.size2{font-size:.75em}.katex .fontsize-ensurer.reset-size4.size3,.katex .katex-sizing.reset-size4.size3{font-size:.875em}.katex .fontsize-ensurer.reset-size4.size4,.katex .katex-sizing.reset-size4.size4{font-size:1em}.katex .fontsize-ensurer.reset-size4.size5,.katex .katex-sizing.reset-size4.size5{font-size:1.125em}.katex .fontsize-ensurer.reset-size4.size6,.katex .katex-sizing.reset-size4.size6{font-size:1.25em}.katex .fontsize-ensurer.reset-size4.size7,.katex .katex-sizing.reset-size4.size7{font-size:1.5em}.katex .fontsize-ensurer.reset-size4.size8,.katex .katex-sizing.reset-size4.size8{font-size:1.8em}.katex .fontsize-ensurer.reset-size4.size9,.katex .katex-sizing.reset-size4.size9{font-size:2.16em}.katex .fontsize-ensurer.reset-size4.size10,.katex .katex-sizing.reset-size4.size10{font-size:2.5925em}.katex .fontsize-ensurer.reset-size4.size11,.katex .katex-sizing.reset-size4.size11{font-size:3.11em}.katex .fontsize-ensurer.reset-size5.size1,.katex .katex-sizing.reset-size5.size1{font-size:.5555555556em}.katex .fontsize-ensurer.reset-size5.size2,.katex .katex-sizing.reset-size5.size2{font-size:.6666666667em}.katex .fontsize-ensurer.reset-size5.size3,.katex .katex-sizing.reset-size5.size3{font-size:.7777777778em}.katex .fontsize-ensurer.reset-size5.size4,.katex .katex-sizing.reset-size5.size4{font-size:.8888888889em}.katex .fontsize-ensurer.reset-size5.size5,.katex .katex-sizing.reset-size5.size5{font-size:1em}.katex .fontsize-ensurer.reset-size5.size6,.katex .katex-sizing.reset-size5.size6{font-size:1.1111111111em}.katex .fontsize-ensurer.reset-size5.size7,.katex .katex-sizing.reset-size5.size7{font-size:1.3333333333em}.katex .fontsize-ensurer.reset-size5.size8,.katex .katex-sizing.reset-size5.size8{font-size:1.6em}.katex .fontsize-ensurer.reset-size5.size9,.katex .katex-sizing.reset-size5.size9{font-size:1.92em}.katex .fontsize-ensurer.reset-size5.size10,.katex .katex-sizing.reset-size5.size10{font-size:2.3044444444em}.katex .fontsize-ensurer.reset-size5.size11,.katex .katex-sizing.reset-size5.size11{font-size:2.7644444444em}.katex .fontsize-ensurer.reset-size6.size1,.katex .katex-sizing.reset-size6.size1{font-size:.5em}.katex .fontsize-ensurer.reset-size6.size2,.katex .katex-sizing.reset-size6.size2{font-size:.6em}.katex .fontsize-ensurer.reset-size6.size3,.katex .katex-sizing.reset-size6.size3{font-size:.7em}.katex .fontsize-ensurer.reset-size6.size4,.katex .katex-sizing.reset-size6.size4{font-size:.8em}.katex .fontsize-ensurer.reset-size6.size5,.katex .katex-sizing.reset-size6.size5{font-size:.9em}.katex .fontsize-ensurer.reset-size6.size6,.katex .katex-sizing.reset-size6.size6{font-size:1em}.katex .fontsize-ensurer.reset-size6.size7,.katex .katex-sizing.reset-size6.size7{font-size:1.2em}.katex .fontsize-ensurer.reset-size6.size8,.katex .katex-sizing.reset-size6.size8{font-size:1.44em}.katex .fontsize-ensurer.reset-size6.size9,.katex .katex-sizing.reset-size6.size9{font-size:1.728em}.katex .fontsize-ensurer.reset-size6.size10,.katex .katex-sizing.reset-size6.size10{font-size:2.074em}.katex .fontsize-ensurer.reset-size6.size11,.katex .katex-sizing.reset-size6.size11{font-size:2.488em}.katex .fontsize-ensurer.reset-size7.size1,.katex .katex-sizing.reset-size7.size1{font-size:.4166666667em}.katex .fontsize-ensurer.reset-size7.size2,.katex .katex-sizing.reset-size7.size2{font-size:.5em}.katex .fontsize-ensurer.reset-size7.size3,.katex .katex-sizing.reset-size7.size3{font-size:.5833333333em}.katex .fontsize-ensurer.reset-size7.size4,.katex .katex-sizing.reset-size7.size4{font-size:.6666666667em}.katex .fontsize-ensurer.reset-size7.size5,.katex .katex-sizing.reset-size7.size5{font-size:.75em}.katex .fontsize-ensurer.reset-size7.size6,.katex .katex-sizing.reset-size7.size6{font-size:.8333333333em}.katex .fontsize-ensurer.reset-size7.size7,.katex .katex-sizing.reset-size7.size7{font-size:1em}.katex .fontsize-ensurer.reset-size7.size8,.katex .katex-sizing.reset-size7.size8{font-size:1.2em}.katex .fontsize-ensurer.reset-size7.size9,.katex .katex-sizing.reset-size7.size9{font-size:1.44em}.katex .fontsize-ensurer.reset-size7.size10,.katex .katex-sizing.reset-size7.size10{font-size:1.7283333333em}.katex .fontsize-ensurer.reset-size7.size11,.katex .katex-sizing.reset-size7.size11{font-size:2.0733333333em}.katex .fontsize-ensurer.reset-size8.size1,.katex .katex-sizing.reset-size8.size1{font-size:.3472222222em}.katex .fontsize-ensurer.reset-size8.size2,.katex .katex-sizing.reset-size8.size2{font-size:.4166666667em}.katex .fontsize-ensurer.reset-size8.size3,.katex .katex-sizing.reset-size8.size3{font-size:.4861111111em}.katex .fontsize-ensurer.reset-size8.size4,.katex .katex-sizing.reset-size8.size4{font-size:.5555555556em}.katex .fontsize-ensurer.reset-size8.size5,.katex .katex-sizing.reset-size8.size5{font-size:.625em}.katex .fontsize-ensurer.reset-size8.size6,.katex .katex-sizing.reset-size8.size6{font-size:.6944444444em}.katex .fontsize-ensurer.reset-size8.size7,.katex .katex-sizing.reset-size8.size7{font-size:.8333333333em}.katex .fontsize-ensurer.reset-size8.size8,.katex .katex-sizing.reset-size8.size8{font-size:1em}.katex .fontsize-ensurer.reset-size8.size9,.katex .katex-sizing.reset-size8.size9{font-size:1.2em}.katex .fontsize-ensurer.reset-size8.size10,.katex .katex-sizing.reset-size8.size10{font-size:1.4402777778em}.katex .fontsize-ensurer.reset-size8.size11,.katex .katex-sizing.reset-size8.size11{font-size:1.7277777778em}.katex .fontsize-ensurer.reset-size9.size1,.katex .katex-sizing.reset-size9.size1{font-size:.2893518519em}.katex .fontsize-ensurer.reset-size9.size2,.katex .katex-sizing.reset-size9.size2{font-size:.3472222222em}.katex .fontsize-ensurer.reset-size9.size3,.katex .katex-sizing.reset-size9.size3{font-size:.4050925926em}.katex .fontsize-ensurer.reset-size9.size4,.katex .katex-sizing.reset-size9.size4{font-size:.462962963em}.katex .fontsize-ensurer.reset-size9.size5,.katex .katex-sizing.reset-size9.size5{font-size:.5208333333em}.katex .fontsize-ensurer.reset-size9.size6,.katex .katex-sizing.reset-size9.size6{font-size:.5787037037em}.katex .fontsize-ensurer.reset-size9.size7,.katex .katex-sizing.reset-size9.size7{font-size:.6944444444em}.katex .fontsize-ensurer.reset-size9.size8,.katex .katex-sizing.reset-size9.size8{font-size:.8333333333em}.katex .fontsize-ensurer.reset-size9.size9,.katex .katex-sizing.reset-size9.size9{font-size:1em}.katex .fontsize-ensurer.reset-size9.size10,.katex .katex-sizing.reset-size9.size10{font-size:1.2002314815em}.katex .fontsize-ensurer.reset-size9.size11,.katex .katex-sizing.reset-size9.size11{font-size:1.4398148148em}.katex .fontsize-ensurer.reset-size10.size1,.katex .katex-sizing.reset-size10.size1{font-size:.2410800386em}.katex .fontsize-ensurer.reset-size10.size2,.katex .katex-sizing.reset-size10.size2{font-size:.2892960463em}.katex .fontsize-ensurer.reset-size10.size3,.katex .katex-sizing.reset-size10.size3{font-size:.337512054em}.katex .fontsize-ensurer.reset-size10.size4,.katex .katex-sizing.reset-size10.size4{font-size:.3857280617em}.katex .fontsize-ensurer.reset-size10.size5,.katex .katex-sizing.reset-size10.size5{font-size:.4339440694em}.katex .fontsize-ensurer.reset-size10.size6,.katex .katex-sizing.reset-size10.size6{font-size:.4821600771em}.katex .fontsize-ensurer.reset-size10.size7,.katex .katex-sizing.reset-size10.size7{font-size:.5785920926em}.katex .fontsize-ensurer.reset-size10.size8,.katex .katex-sizing.reset-size10.size8{font-size:.6943105111em}.katex .fontsize-ensurer.reset-size10.size9,.katex .katex-sizing.reset-size10.size9{font-size:.8331726133em}.katex .fontsize-ensurer.reset-size10.size10,.katex .katex-sizing.reset-size10.size10{font-size:1em}.katex .fontsize-ensurer.reset-size10.size11,.katex .katex-sizing.reset-size10.size11{font-size:1.1996142719em}.katex .fontsize-ensurer.reset-size11.size1,.katex .katex-sizing.reset-size11.size1{font-size:.2009646302em}.katex .fontsize-ensurer.reset-size11.size2,.katex .katex-sizing.reset-size11.size2{font-size:.2411575563em}.katex .fontsize-ensurer.reset-size11.size3,.katex .katex-sizing.reset-size11.size3{font-size:.2813504823em}.katex .fontsize-ensurer.reset-size11.size4,.katex .katex-sizing.reset-size11.size4{font-size:.3215434084em}.katex .fontsize-ensurer.reset-size11.size5,.katex .katex-sizing.reset-size11.size5{font-size:.3617363344em}.katex .fontsize-ensurer.reset-size11.size6,.katex .katex-sizing.reset-size11.size6{font-size:.4019292605em}.katex .fontsize-ensurer.reset-size11.size7,.katex .katex-sizing.reset-size11.size7{font-size:.4823151125em}.katex .fontsize-ensurer.reset-size11.size8,.katex .katex-sizing.reset-size11.size8{font-size:.578778135em}.katex .fontsize-ensurer.reset-size11.size9,.katex .katex-sizing.reset-size11.size9{font-size:.6945337621em}.katex .fontsize-ensurer.reset-size11.size10,.katex .katex-sizing.reset-size11.size10{font-size:.8336012862em}.katex .fontsize-ensurer.reset-size11.size11,.katex .katex-sizing.reset-size11.size11{font-size:1em}.katex .delimsizing.size1{font-family:KaTeX_Size1}.katex .delimsizing.size2{font-family:KaTeX_Size2}.katex .delimsizing.size3{font-family:KaTeX_Size3}.katex .delimsizing.size4{font-family:KaTeX_Size4}.katex .delimsizing.mult .delim-size1>span{font-family:KaTeX_Size1}.katex .delimsizing.mult .delim-size4>span{font-family:KaTeX_Size4}.katex .nulldelimiter{display:inline-block;width:.12em}.katex .delimcenter,.katex .op-symbol{position:relative}.katex .op-symbol.small-op{font-family:KaTeX_Size1}.katex .op-symbol.large-op{font-family:KaTeX_Size2}.katex .katex-accent>.vlist-t,.katex .op-limits>.vlist-t{text-align:center}.katex .katex-accent .accent-body{position:relative}.katex .katex-accent .accent-body:not(.accent-full){width:0}.katex .katex-overlay{display:block}.katex .mtable .vertical-separator{display:inline-block;min-width:1px}.katex .mtable .arraycolsep{display:inline-block}.katex .mtable .col-align-c>.vlist-t{text-align:center}.katex .mtable .col-align-l>.vlist-t{text-align:left}.katex .mtable .col-align-r>.vlist-t{text-align:right}.katex .svg-align{text-align:left}.katex svg{fill:currentColor;stroke:currentColor;display:block;height:inherit;position:absolute;width:100%}.katex svg path{stroke:none}.katex svg{fill-rule:nonzero;fill-opacity:1;stroke-width:1;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1}.katex img{border-style:none;max-height:none;max-width:none;min-height:0;min-width:0}.katex .katex-stretchy{display:block;overflow:hidden;position:relative;width:100%}.katex .katex-stretchy:after,.katex .katex-stretchy:before{content:""}.katex .hide-tail{overflow:hidden;position:relative;width:100%}.katex .halfarrow-left{left:0;overflow:hidden;position:absolute;width:50.2%}.katex .halfarrow-right{overflow:hidden;position:absolute;right:0;width:50.2%}.katex .brace-left{left:0;overflow:hidden;position:absolute;width:25.1%}.katex .brace-center{left:25%;overflow:hidden;position:absolute;width:50%}.katex .brace-right{overflow:hidden;position:absolute;right:0;width:25.1%}.katex .x-arrow-pad{padding:0 .5em}.katex .cd-arrow-pad{padding:0 .55556em 0 .27778em}.katex .mover,.katex .munder,.katex .x-arrow{text-align:center}.katex .boxpad{padding:0 .3em}.katex .fbox,.katex .fcolorbox{border:.04em solid;box-sizing:border-box}.katex .cancel-pad{padding:0 .2em}.katex .cancel-lap{margin-left:-.2em;margin-right:-.2em}.katex .katex-sout{border-bottom-style:solid;border-bottom-width:.08em}.katex .angl{border-right:.049em solid;border-top:.049em solid;box-sizing:border-box;margin-right:.03889em}.katex .anglpad{padding:0 .03889em}.katex .reflectbox{display:inline-block;transform:scaleX(-1)}.katex .eqn-num:before{content:"(" counter(katexEqnNo) ")";counter-increment:katexEqnNo}.katex .mml-eqn-num:before{content:"(" counter(mmlEqnNo) ")";counter-increment:mmlEqnNo}.katex .mtr-glue{width:50%}.katex .cd-vert-arrow{display:inline-block;position:relative}.katex .cd-label-left{display:inline-block;position:absolute;right:calc(50% + .3em);text-align:left}.katex .cd-label-right{display:inline-block;left:calc(50% + .3em);position:absolute;text-align:right}.katex-display{display:block;margin:1em 0;text-align:center}.katex-display>.katex{display:block;text-align:center;white-space:nowrap}.katex-display>.katex>.katex-html{display:block;position:relative}.katex-display>.katex>.katex-html>.katex-tag{position:absolute;right:0}.katex-display.leqno>.katex>.katex-html>.katex-tag{left:0;right:auto}.katex-display.fleqn>.katex{padding-left:2em;text-align:left}body{counter-reset:katexEqnNo mmlEqnNo}
`;function te(e){if(`html`in e)return`<div class="matrx-print-block">${e.html}</div>`;if(`image`in e){let{src:t,alt:n,caption:r}=e.image;return`<figure class="matrx-print-block matrx-print-image"><img src="${g(t)}" alt="${g(n??`Picture`)}" style="max-width:100%;height:auto">${r?`<figcaption>${g(r)}</figcaption>`:``}</figure>`}return`<p class="matrx-print-block matrx-print-notice" style="border:1px dashed #94a3b8;border-radius:6px;padding:10px 12px;color:#475569;font-style:italic">${g(e.notice)}</p>`}function ne(e){if(!e.includes(`class="katex"`)||e.includes(x))return e;let t=`<style data-matrx-katex>${S}</style>`,n=e.search(/<\/head>/i);return n>=0?e.slice(0,n)+t+e.slice(n):t+e}function re(e,t=`print`,n=`width=920,height=720,scrollbars=yes`){let r=ne(e),i=window.open(``,`_blank`,n);return i?(i.document.open(),i.document.write(r),i.document.close(),`opened`):ae(r,t)}function ie(e=`print`,t=`width=920,height=720,scrollbars=yes`){let n=window.open(``,`_blank`,t);return n&&(n.document.open(),n.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Preparing…</title></head><body style="font:14px -apple-system,BlinkMacSystemFont,sans-serif;color:#555;padding:2rem">Preparing the document for print…</body></html>`),n.document.close()),{write(t){let r=ne(t);return!n||n.closed?ae(r,e):(n.document.open(),n.document.write(r),n.document.close(),`opened`)}}}function ae(e,t){return h(`${t.replace(/\s+/g,`-`).toLowerCase()}.html`,e,`text/html;charset=utf-8`),`downloaded`}[`[data-print-hide]`,`[role="toolbar"]`,`[role="menu"]`,`[role="menubar"]`,`button`,`[role="button"]`,`input[type="button"]`,`input[type="submit"]`,`input[type="reset"]`].join(`,`);var oe=[`script`,`style`,`noscript`,`template`,`iframe`,`object`,`embed`,`textarea`,`select`,`head`,`title`],se=[...oe,`form`,`meta`,`base`,`link`,`frame`,`frameset`,`applet`,`button`,`svg`,`math`],C=_.attributes??{},w={..._,tagNames:(_.tagNames??[]).filter(e=>!se.includes(e)),strip:oe,clobberPrefix:``,clobber:[]},T=/^(?:(?:matrx|print|code|doc|language)-[\w-]*|inline-code|is-checked)$/;function E(e=[]){let t=!1,n=e.map(e=>Array.isArray(e)&&e[0]===`className`?(t=!0,[...e,T]):e);return t?n:[...n,[`className`,T]]}var ce=Object.fromEntries(Object.entries(C).map(([e,t])=>[e,E(t)])),le=[`style`,/^text-align:\s*(?:left|center|right);?$/],D={...w,tagNames:[...new Set([...w.tagNames??[],`section`,`figure`,`figcaption`,`label`])],attributes:{...ce,"*":[...C[`*`]??[],[`className`,T],`role`,`ariaLabel`,`ariaHidden`,`dataLabel`,`dataLanguage`,`dataArtifactType`],td:E([...C.td??[],[...le]]),th:E([...C.th??[],[...le]]),input:E([[`type`,`checkbox`],`checked`]),label:E([`htmlFor`])},required:{input:{type:`checkbox`}},protocols:{..._.protocols,href:[..._.protocols?.href??[],`tel`],src:[..._.protocols?.src??[],`data`]}};function ue(e,t=w){if(!e)return``;let n=v(ee(e,{fragment:!0}),t);return y(n,{characterReferences:{useNamedReferences:!0}})}var O=`math.maction.annotation.menclose.merror.mfrac.mglyph.mi.mlabeledtr.mmultiscripts.mn.mo.mover.mpadded.mphantom.mprescripts.none.mroot.mrow.ms.mspace.msqrt.mstyle.msub.msubsup.msup.mtable.mtd.mtext.mtr.munder.munderover.semantics`.split(`.`),de=`xmlns.display.displaystyle.mathvariant.mathsize.mathcolor.mathbackground.scriptlevel.dir.fence.form.largeop.lspace.rspace.movablelimits.separator.stretchy.symmetric.maxsize.minsize.accent.accentunder.align.columnalign.rowalign.columnspacing.rowspacing.columnlines.rowlines.frame.framespacing.equalrows.equalcolumns.linethickness.numalign.denomalign.bevelled.notation.width.height.depth.voffset.lquote.rquote.columnspan.rowspan.encoding.open.close.separators.actiontype.selection.mslinebreak.linebreak.indentalign.data*`.split(`.`);function fe(e=[]){let t=e.length?[RegExp(`^(?:${[...new Set(e)].map(e=>e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`)).join(`|`)})$`)]:[],n=Object.fromEntries(O.map(e=>[e,de])),r=D.attributes??{},i=(e=[])=>t.length?[...e.filter(e=>!(Array.isArray(e)&&e[0]===`style`)),[`style`,...t]]:e,a={...r,...n};if(t.length)for(let e of new Set([...D.tagNames??[],`div`,`span`]))O.includes(e)||(a[e]=i(r[e]??[]));return{...D,tagNames:[...new Set([...D.tagNames??[],...O])],attributes:a}}function pe(e,t=[]){return ue(e,fe(t))}var me=``,he=``,ge=/\uE100(\d+)\uE101/g,_e={$$:{open:2,close:2,display:!0},"\\[":{open:2,close:2,display:!0},$:{open:1,close:1,display:!1},"\\(":{open:2,close:2,display:!1}};function ve(e){let t=[];if(!/[$\\]/.test(e))return{text:e,spans:t};let n=r(p(e)).filter(e=>e.complete&&(e.islandType===`math_block`||e.islandType===`math_inline`)).sort((e,t)=>e.start-t.start),i=``,a=0;for(let r of n){let n=_e[String(r.meta.delimiter??``)];!n||r.start<a||(i+=e.slice(a,r.start),t.push({tex:e.slice(r.start+n.open,r.end-n.close).trim(),display:n.display}),i+=`${me}${t.length-1}${he}`,a=r.end)}return{text:i+e.slice(a),spans:t}}function ye(e,t){return b.renderToString(e,{displayMode:t,output:`htmlAndMathml`,throwOnError:!1,trust:!1,strict:`ignore`})}var be=`:root {
    --matrx-print-accent: #667eea;
    --matrx-print-accent-2: #764ba2;
    --matrx-print-bg: #ffffff;
    --matrx-print-border: #e1e1e1;
    --matrx-print-border-muted: #d1d5db;
    --matrx-print-border-strong: #e5e5e5;
    --matrx-print-code-bg: #f5f5f5;
    --matrx-print-code-block-bg: #f8f8f8;
    --matrx-print-code-block-fg: #333;
    --matrx-print-code-fg: #d73a49;
    --matrx-print-fg: #1a1a1a;
    --matrx-print-fg-muted: #4a4a4a;
    --matrx-print-fg-subtle: #6b7280;
    --matrx-print-heading: #2a2a2a;
    --matrx-print-heading-sub: #3a3a3a;
    --matrx-print-link-fg: #374151;
    --matrx-print-link-hover-fg: #1f2937;
    --matrx-print-link-underline: #9ca3af;
    --matrx-print-quote-fg: #666;
    --matrx-print-shadow: rgba(0, 0, 0, 0.1);
    --matrx-print-shadow-strong: rgba(0, 0, 0, 0.2);
    --matrx-print-success: #2d5016;
    --matrx-print-success-2: #1e3a0f;
    --matrx-print-surface: #f8f9fa;
    --matrx-print-table-fg: #333333;
}`,k=`:root {
    --matrx-print-accent: #2563eb;
    --matrx-print-bg: #fff;
    --matrx-print-border: #e5e7eb;
    --matrx-print-border-muted: #d1d5db;
    --matrx-print-code-bg: #f1f5f9;
    --matrx-print-fg: #1a1a1a;
    --matrx-print-fg-muted: #374151;
    --matrx-print-fg-subtle: #64748b;
    --matrx-print-heading: #111827;
    --matrx-print-ink: #0f172a;
    --matrx-print-line: #e2e8f0;
    --matrx-print-quote-bg: #f5f3ff;
    --matrx-print-quote-border: #6366f1;
    --matrx-print-surface: #f8fafc;
    --matrx-print-surface-sunken: #f3f4f6;
    --matrx-print-table-head-bg: #1e293b;
    --matrx-print-table-head-border: #334155;
}`,A=`/* 
 * MATRX WordPress CSS - Production Ready
 * Use this CSS in your WordPress theme to style MATRX content
 * All styles are scoped to .matrx-content-container to avoid conflicts
 */

/* Content Container */
.matrx-content-container {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
    line-height: 1.6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}

/* Typography */
.matrx-h1 {
    font-size: 2.5rem;
    font-weight: 700;
    margin: 0 0 1.5rem 0;
    color: var(--matrx-print-fg, #1a1a1a);
    line-height: 1.2;
}

.matrx-h2 {
    font-size: 1.8rem;
    font-weight: 600;
    margin: 3rem 0 1rem 0 !important;
    color: var(--matrx-print-heading, #2a2a2a);
    line-height: 1.3 !important;
    border-bottom: 2px solid var(--matrx-print-border-strong, #e5e5e5);
    padding-bottom: 0.75rem !important;
    padding-top: 0 !important;
}

.matrx-h3 {
    font-size: 1.3rem;
    font-weight: 600;
    margin: 2rem 0 1rem 0;
    color: var(--matrx-print-heading-sub, #3a3a3a);
    line-height: 1.4;
}

.matrx-h4 {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 1.5rem 0 0.75rem 0;
    color: var(--matrx-print-heading-sub, #3a3a3a);
    line-height: 1.4;
}

.matrx-h5 {
    font-size: 1rem;
    font-weight: 600;
    margin: 1.25rem 0 0.5rem 0;
    color: var(--matrx-print-heading-sub, #3a3a3a);
    line-height: 1.4;
}

.matrx-h6 {
    font-size: 0.9rem;
    font-weight: 600;
    margin: 1rem 0 0.5rem 0;
    color: var(--matrx-print-heading-sub, #3a3a3a);
    line-height: 1.4;
}

/* Paragraphs */
.matrx-intro {
    font-size: 1.1rem;
    color: var(--matrx-print-fg-muted, #4a4a4a);
    margin-bottom: 2rem;
    padding: 1.5rem;
    background: var(--matrx-print-surface, #f8f9fa);
    border-left: 4px solid var(--matrx-print-border-muted, #d1d5db);
    border-radius: 0 8px 8px 0;
}

.matrx-paragraph {
    font-size: 1rem;
    color: var(--matrx-print-fg-muted, #4a4a4a);
    margin-bottom: 1.5rem;
    text-align: justify;
}

/* Text Formatting */
.matrx-em {
    font-style: italic;
    color: var(--matrx-print-heading, #2a2a2a);
}

.matrx-strong {
    font-weight: 600;
    color: var(--matrx-print-heading, #2a2a2a);
}

/* Links */
.matrx-link {
    color: var(--matrx-print-link-fg, #374151);
    text-decoration: underline;
    text-decoration-color: var(--matrx-print-border-muted, #d1d5db);
    text-underline-offset: 3px;
    transition: all 0.2s ease;
}

.matrx-link:hover {
    color: var(--matrx-print-link-hover-fg, #1f2937);
    text-decoration-color: var(--matrx-print-link-underline, #9ca3af);
}

/* Images */
.matrx-image {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 1.5rem auto;
    border-radius: 8px;
    box-shadow: 0 2px 8px var(--matrx-print-shadow, rgba(0, 0, 0, 0.1));
}

/* Lists */
.matrx-list {
    margin: 1.5rem 0;
    padding-left: 0;
}

.matrx-bullet-list {
    list-style: none;
}

.matrx-list-item {
    margin-bottom: 1rem;
    padding-left: 1.5rem;
    position: relative;
    color: var(--matrx-print-fg-muted, #4a4a4a);
}

.matrx-list-item::before {
    content: "•";
    color: var(--matrx-print-fg-subtle, #6b7280);
    font-weight: bold;
    position: absolute;
    left: 0;
    top: 0;
    font-size: 1.2rem;
}

/* Numbered Lists */
.matrx-numbered-list {
    list-style: decimal;
    padding-left: 2rem;
}

.matrx-numbered-list > .matrx-list-item {
    padding-left: 0.5rem;
}

.matrx-numbered-list > .matrx-list-item::before {
    content: none;
    /* Remove the bullet */
}

/* Nested list indentation */
.matrx-nested-list {
    margin-top: 0.5rem;
    margin-bottom: 0.5rem;
    padding-left: 1.5rem !important;
}

/* Ensure nested lists within list items are properly indented */
.matrx-list-item > .matrx-list {
    margin-top: 0.5rem;
    margin-bottom: 0.5rem;
    padding-left: 1.5rem;
}

/* For multiple levels of nesting, increase indentation */
.matrx-nested-list .matrx-nested-list {
    padding-left: 1.5rem !important;
}

/* Code */
.matrx-content-container .matrx-inline-code {
    background-color: var(--matrx-print-code-bg, #f5f5f5);
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
    font-size: 0.875rem;
    color: var(--matrx-print-code-fg, #d73a49);
}

.matrx-content-container .matrx-code-block {
    background-color: var(--matrx-print-code-block-bg, #f8f8f8);
    border: 1px solid var(--matrx-print-border, #e1e1e1);
    border-radius: 0.375rem;
    padding: 1rem;
    margin: 1.5rem 0;
    overflow-x: auto;
}

.matrx-content-container .matrx-code {
    font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--matrx-print-code-block-fg, #333);
}

/* Blockquotes */
.matrx-content-container .matrx-blockquote {
    border-left: 4px solid var(--matrx-print-border, #e1e1e1);
    padding-left: 1rem;
    margin: 1.5rem 0;
    font-style: italic;
    color: var(--matrx-print-quote-fg, #666);
}

/* Tables */
.matrx-content-container .matrx-table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.5rem 0;
    border: 1px solid var(--matrx-print-border, #e1e1e1);
}

.matrx-content-container .matrx-table-header {
    background-color: var(--matrx-print-surface, #f8f9fa);
    font-weight: 600;
    padding: 0.75rem;
    border: 1px solid var(--matrx-print-border, #e1e1e1);
    text-align: left;
}

.matrx-content-container .matrx-table-cell {
    padding: 0.75rem;
    border: 1px solid var(--matrx-print-border, #e1e1e1);
}

.matrx-content-container .matrx-table-row:nth-child(even) {
    background-color: var(--matrx-print-surface, #f8f9fa);
}

/* Images */
.matrx-content-container .matrx-image {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
    margin: 1rem 0;
}

/* Horizontal Rules */
.matrx-content-container .matrx-hr {
    border: none;
    border-top: 1px solid var(--matrx-print-border, #e1e1e1);
    margin: 2rem 0;
}

/* FAQ Styles - Clean Design */
.matrx-faq-item {
    margin-bottom: 2rem;
    padding: 1.5rem;
    background: var(--matrx-print-surface, #f8f9fa);
    border-radius: 8px;
    border-left: 4px solid var(--matrx-print-border-muted, #d1d5db);
}

.matrx-faq-question {
    font-size: 1.2rem;
    font-weight: 600;
    margin: 0 0 0.75rem 0;
    color: var(--matrx-print-heading, #2a2a2a);
}

.matrx-faq-answer {
    margin: 0;
    color: var(--matrx-print-fg-muted, #4a4a4a);
    line-height: 1.6;
}

/* Code Blocks */
.matrx-inline-code {
    background-color: var(--matrx-print-code-bg, #f5f5f5);
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
    font-size: 0.875rem;
    color: var(--matrx-print-code-fg, #d73a49);
}

.matrx-code-block {
    background-color: var(--matrx-print-code-block-bg, #f8f8f8);
    border: 1px solid var(--matrx-print-border, #e1e1e1);
    border-radius: 0.375rem;
    padding: 1rem;
    margin: 1.5rem 0;
    overflow-x: auto;
}

.matrx-code {
    font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--matrx-print-code-block-fg, #333);
}

/* Blockquotes */
.matrx-blockquote {
    border-left: 4px solid var(--matrx-print-border, #e1e1e1);
    padding-left: 1rem;
    margin: 1.5rem 0;
    font-style: italic;
    color: var(--matrx-print-quote-fg, #666);
}

/* Tables */
.matrx-table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.5rem 0;
    border: 1px solid var(--matrx-print-border, #e1e1e1);
    color: var(--matrx-print-table-fg, #333333);
}

.matrx-table-head {
    background-color: var(--matrx-print-surface, #f8f9fa);
}

.matrx-table-body {
    background-color: var(--matrx-print-bg, #ffffff);
}

.matrx-table-header {
    background-color: var(--matrx-print-surface, #f8f9fa);
    font-weight: 600;
    padding: 0.75rem;
    border: 1px solid var(--matrx-print-border, #e1e1e1);
    text-align: left;
    color: var(--matrx-print-table-fg, #333333);
}

.matrx-table-cell {
    padding: 0.75rem;
    border: 1px solid var(--matrx-print-border, #e1e1e1);
    color: var(--matrx-print-table-fg, #333333);
}

.matrx-table-row {
    color: var(--matrx-print-table-fg, #333333);
}

.matrx-table-row:nth-child(even) {
    background-color: var(--matrx-print-surface, #f8f9fa);
}

/* Ensure table content doesn't inherit external colors */
.matrx-table * {
    color: inherit;
}

/* Images */
.matrx-image {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
    margin: 1rem 0;
}

/* Horizontal Rules */
.matrx-hr {
    border: none;
    border-top: 1px solid var(--matrx-print-border, #e1e1e1);
    margin: 2rem 0;
}

/* Utility Classes */
.matrx-div {
    margin: 0.5rem 0;
}

.matrx-span {
    /* Inherit parent styling by default */
}

/* Flashcard Styles */
.matrx-flashcards-container {
    margin: 2rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.matrx-flashcard {
    perspective: 1000px;
    perspective-origin: center center;
    height: 200px;
    cursor: pointer;
    position: relative;
    margin-bottom: 0.5rem;
}

.matrx-flashcard-input {
    display: none;
}

.matrx-flashcard-inner {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    transition: transform 0.6s;
    transform-style: preserve-3d;
    transform-origin: center center;
}

.matrx-flashcard-input:checked ~ .matrx-flashcard-inner {
    transform: rotateY(180deg);
}

.matrx-flashcard-front,
.matrx-flashcard-back {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    backface-visibility: hidden;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    box-shadow: 0 4px 6px var(--matrx-print-shadow, rgba(0, 0, 0, 0.1));
    transition: box-shadow 0.3s ease;
    box-sizing: border-box;
}

.matrx-flashcard-front {
    background: linear-gradient(135deg, var(--matrx-print-accent, #667eea) 0%, var(--matrx-print-accent-2, #764ba2) 100%);
    color: white;
}

.matrx-flashcard-back {
    background: linear-gradient(135deg, var(--matrx-print-success, #2d5016) 0%, var(--matrx-print-success-2, #1e3a0f) 100%);
    color: white;
    transform: rotateY(180deg);
}

.matrx-flashcard:hover .matrx-flashcard-front,
.matrx-flashcard:hover .matrx-flashcard-back {
    box-shadow: 0 8px 16px var(--matrx-print-shadow-strong, rgba(0, 0, 0, 0.2));
}

.matrx-flashcard-content {
    text-align: center;
    font-size: 1.3rem;
    line-height: 1.8;
    max-height: 100%;
    width: 100%;
    overflow: hidden;
}

.matrx-flashcard-label {
    cursor: pointer;
    user-select: none;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 10;
}

.matrx-flashcard-indicator {
    position: absolute;
    bottom: 12px;
    right: 16px;
    font-size: 0.75rem;
    opacity: 0.8;
    font-weight: 500;
    letter-spacing: 0.5px;
}

/* Responsive adjustments */
@media (max-width: 768px) {
    .matrx-flashcard {
        height: 180px;
    }

    .matrx-flashcard-content {
        font-size: 1rem;
    }

    .matrx-flashcard-front,
    .matrx-flashcard-back {
        padding: 1.25rem;
    }
}

@media (max-width: 480px) {
    .matrx-flashcard {
        height: 160px;
    }

    .matrx-flashcard-content {
        font-size: 0.95rem;
    }

    .matrx-flashcard-front,
    .matrx-flashcard-back {
        padding: 1rem;
    }
}

/* Responsive Design */
@media (max-width: 768px) {
    .matrx-content-container {
        padding: 1rem;
    }

    .matrx-h1 {
        font-size: 2rem;
    }

    .matrx-h2 {
        font-size: 1.5rem;
        margin: 2rem 0 1rem 0 !important;
    }

    .matrx-h3 {
        font-size: 1.2rem;
    }

    .matrx-h4 {
        font-size: 1.05rem;
    }

    .matrx-h5 {
        font-size: 0.95rem;
    }

    .matrx-h6 {
        font-size: 0.9rem;
    }

    .matrx-intro {
        padding: 1rem;
        font-size: 1rem;
    }

    .matrx-faq-question {
        font-size: 1.1rem;
        margin: 1.5rem 0 0.75rem 0;
    }

    .matrx-paragraph {
        text-align: left;
    }

    .matrx-table {
        font-size: 0.875rem;
    }

    .matrx-table-header,
    .matrx-table-cell {
        padding: 0.5rem;
    }

    .matrx-code-block {
        padding: 0.75rem;
        margin: 1rem 0;
    }
}

@media (max-width: 480px) {
    .matrx-content-container {
        padding: 0.75rem;
    }

    .matrx-h1 {
        font-size: 1.75rem;
        margin-bottom: 1rem;
    }

    .matrx-h2 {
        font-size: 1.3rem;
        margin: 1.5rem 0 0.75rem 0 !important;
    }

    .matrx-h3 {
        font-size: 1.1rem;
        margin: 1.5rem 0 0.75rem 0;
    }

    .matrx-h4 {
        font-size: 1rem;
        margin: 1.25rem 0 0.5rem 0;
    }

    .matrx-h5 {
        font-size: 0.9rem;
        margin: 1rem 0 0.5rem 0;
    }

    .matrx-h6 {
        font-size: 0.85rem;
        margin: 1rem 0 0.5rem 0;
    }

    .matrx-intro {
        padding: 0.75rem;
        margin-bottom: 1.5rem;
    }

    .matrx-paragraph {
        margin-bottom: 1.25rem;
    }

    .matrx-list-item {
        margin-bottom: 0.75rem;
    }

    .matrx-table-header,
    .matrx-table-cell {
        padding: 0.375rem;
    }

    .matrx-code-block {
        padding: 0.5rem;
        font-size: 0.8rem;
    }

    .matrx-inline-code {
        font-size: 0.8rem;
    }
}
/* Print / PDF hard parts — added by @ai-matrx/print 0.3.0. */
@media print {
    .matrx-content-container {
        max-width: 100%;
        padding: 0;
    }

    .matrx-h1,
    .matrx-h2,
    .matrx-h3,
    .matrx-h4,
    .matrx-h5,
    .matrx-h6 {
        page-break-after: avoid;
        break-after: avoid;
    }

    .matrx-paragraph,
    .matrx-intro {
        orphans: 3;
        widows: 3;
    }

    .matrx-table,
    .matrx-code-block,
    .matrx-blockquote,
    .matrx-list-item,
    .matrx-image,
    .matrx-faq-item,
    .matrx-flashcard {
        page-break-inside: avoid;
        break-inside: avoid;
    }

    .matrx-table-header,
    .matrx-code-block,
    .matrx-blockquote,
    .matrx-flashcard {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    .matrx-link {
        text-decoration: underline;
    }
}
`,j=`*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}body{font-family:Georgia,'Times New Roman',serif;font-size:11pt;line-height:1.7;color:var(--matrx-print-fg, #1a1a1a);background:var(--matrx-print-bg, #fff);max-width:780px;margin:0 auto;padding:32px 40px}.print-actions{display:flex;gap:10px;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid var(--matrx-print-border, #e5e7eb)}.print-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 20px;border-radius:8px;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer;border:none;font-weight:600;transition:opacity .15s}.print-btn:hover{opacity:.85}.print-btn-primary{background:var(--matrx-print-accent, #2563eb);color:var(--matrx-print-bg, #fff)}.print-btn-secondary{background:var(--matrx-print-surface-sunken, #f3f4f6);color:var(--matrx-print-fg-muted, #374151);border:1px solid var(--matrx-print-border-muted, #d1d5db)}h1,h2,h3,h4,h5,h6{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',sans-serif;font-weight:700;line-height:1.3;color:var(--matrx-print-heading, #111827);margin-top:1.6em;margin-bottom:.5em;page-break-after:avoid}h1{font-size:24pt;border-bottom:2px solid var(--matrx-print-border, #e5e7eb);padding-bottom:.3em;margin-top:0}h2{font-size:18pt;border-bottom:1px solid var(--matrx-print-border, #e5e7eb);padding-bottom:.2em}h3{font-size:14pt}p{margin-bottom:.9em;orphans:3;widows:3}a{color:var(--matrx-print-accent, #2563eb);text-decoration:underline;word-break:break-word}ul,ol{margin:.6em 0 .9em 0;padding-left:1.8em}li{margin-bottom:.3em;page-break-inside:avoid}blockquote{margin:1em 0;padding:.7em 1em .7em 1.2em;border-left:4px solid var(--matrx-print-quote-border, #6366f1);background:var(--matrx-print-quote-bg, #f5f3ff);border-radius:0 6px 6px 0;color:var(--matrx-print-fg-muted, #374151);font-style:italic;page-break-inside:avoid}.inline-code{font-family:'JetBrains Mono','Fira Code',monospace;font-size:9.5pt;background:var(--matrx-print-code-bg, #f1f5f9);color:var(--matrx-print-ink, #0f172a);padding:1px 5px;border-radius:4px;border:1px solid var(--matrx-print-line, #e2e8f0)}.code-block-wrapper{position:relative;margin:1em 0 1.2em;border-radius:8px;overflow:hidden;border:1px solid var(--matrx-print-line, #e2e8f0);page-break-inside:avoid}.code-lang{display:block;font-family:-apple-system,sans-serif;font-size:9pt;font-weight:600;color:var(--matrx-print-fg-subtle, #64748b);background:var(--matrx-print-surface, #f8fafc);padding:4px 12px;border-bottom:1px solid var(--matrx-print-line, #e2e8f0);text-transform:uppercase;letter-spacing:.05em}.code-block{margin:0;padding:14px 16px;background:var(--matrx-print-ink, #0f172a);color:var(--matrx-print-line, #e2e8f0);font-family:'JetBrains Mono',monospace;font-size:9pt;line-height:1.6;overflow-x:auto;white-space:pre;tab-size:2}.print-table{width:100%;border-collapse:collapse;margin:1em 0 1.2em;font-size:10pt;page-break-inside:avoid}.print-table th{background:var(--matrx-print-table-head-bg, #1e293b);color:var(--matrx-print-surface, #f8fafc);font-family:-apple-system,sans-serif;font-weight:600;font-size:9.5pt;text-align:left;padding:8px 12px;border:1px solid var(--matrx-print-table-head-border, #334155)}.print-table td{padding:7px 12px;border:1px solid var(--matrx-print-line, #e2e8f0);vertical-align:top}.print-table tr:nth-child(even) td{background:var(--matrx-print-surface, #f8fafc)}hr{border:none;border-top:2px solid var(--matrx-print-border, #e5e7eb);margin:1.5em 0}.print-figure{margin:1em 0 1.2em;page-break-inside:avoid}.print-image{display:block;max-width:100%;height:auto;margin:0 auto;border-radius:6px}.print-figure figcaption{margin-top:.4em;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:9.5pt;color:var(--matrx-print-fg-subtle, #64748b)}@media print{body{max-width:100%;padding:0;font-size:10.5pt}.print-actions{display:none!important}.code-block,.print-table th,blockquote{color-adjust:exact;-webkit-print-color-adjust:exact;print-color-adjust:exact}a[href]::after{content:" ("attr(href)")";font-size:9pt;color:var(--matrx-print-fg-subtle, #64748b)}a[href^="#"]::after,a[href^="javascript:"]::after{content:""}h1,h2,h3{page-break-after:avoid}pre,blockquote,table{page-break-inside:avoid}}`,M=`
.matrx-page-break {
    position: relative;
    clear: both;
    height: 0;
    margin: 2.75rem 0;
    border: 0;
    border-top: 2px dashed var(--matrx-print-border-muted, #d1d5db);
}
.matrx-page-break::after {
    content: attr(data-label);
    position: absolute;
    left: 50%;
    top: 0;
    transform: translate(-50%, -50%);
    padding: 0 0.75rem;
    background: var(--matrx-print-bg, #ffffff);
    color: var(--matrx-print-fg-subtle, #6b7280);
    font: 600 10px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
}
/* GFM footnotes: numbered superscript references, notes gathered at the end. */
.print-footnote-ref {
    font-size: 0.75em;
    line-height: 0;
    vertical-align: super;
}
.print-footnote-ref a {
    text-decoration: none;
}
.print-footnotes {
    margin-top: 2em;
    font-size: 0.9em;
    color: var(--matrx-print-fg-subtle, #6b7280);
    page-break-inside: avoid;
}
.print-footnotes hr {
    width: 33%;
    margin: 0 0 0.75em;
    border: 0;
    border-top: 1px solid var(--matrx-print-border-muted, #d1d5db);
}
.print-footnotes ol {
    margin: 0;
    padding-left: 1.6em;
}
.print-footnotes li p {
    margin: 0 0 0.35em;
}

.matrx-artifact {
    margin: 1.25em 0;
    border: 1px solid var(--matrx-print-border, #e5e7eb);
    border-radius: 8px;
    overflow: hidden;
}
.matrx-artifact-header {
    display: flex;
    align-items: baseline;
    gap: 0.6em;
    padding: 0.45em 0.9em;
    background: var(--matrx-print-surface, #f8fafc);
    border-bottom: 1px solid var(--matrx-print-border, #e5e7eb);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.matrx-artifact-kind {
    font-size: 0.72em;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--matrx-print-accent, #2563eb);
}
.matrx-artifact-title {
    font-weight: 600;
    color: var(--matrx-print-fg, #1a1a1a);
}
.matrx-artifact-body {
    padding: 0.8em 0.9em;
}
.matrx-artifact-body > :first-child {
    margin-top: 0;
}
.matrx-artifact-body > :last-child {
    margin-bottom: 0;
}
/* The panel's kind chip already names these languages. */
.matrx-artifact:is([data-artifact-type="html"], [data-artifact-type="react"], [data-artifact-type="svg"], [data-artifact-type="mermaid"], [data-artifact-type="diff"], [data-artifact-type="iframe"]) .code-lang {
    display: none;
}
.matrx-artifact-empty {
    margin: 0;
    font-style: italic;
    color: var(--matrx-print-fg-subtle, #6b7280);
}

li.matrx-task-item {
    list-style: none;
}
/* The box IS the marker — the document skin's custom bullet must not sit on it. */
:is(.matrx-content-container, .content) li.matrx-task-item::before {
    content: none;
}
.matrx-task-box {
    position: relative;
    display: inline-block;
    width: 0.9em;
    height: 0.9em;
    margin: 0 0.5em 0 -1.35em;
    border: 1.5px solid var(--matrx-print-fg-muted, #4a4a4a);
    border-radius: 3px;
    vertical-align: -0.1em;
}
.matrx-task-box.is-checked::after {
    content: "\\2713";
    position: absolute;
    inset: 0;
    font-size: 0.8em;
    font-weight: 700;
    line-height: 1.1em;
    text-align: center;
    color: var(--matrx-print-fg, #1a1a1a);
}

:is(.matrx-content-container, .content) del {
    color: var(--matrx-print-fg-muted, #4a4a4a);
    text-decoration: line-through;
}
:is(.matrx-content-container, .content) hr.matrx-hr-accent {
    height: 2px;
    margin: 1.75em 0;
    border: 0;
    border-radius: 2px;
    background: var(--matrx-print-accent, #2563eb);
    opacity: 0.6;
}
:is(.matrx-content-container, .content) hr.matrx-hr-heavy {
    height: 4px;
    margin: 2.25em 0;
    border: 0;
    border-radius: 4px;
    background: var(--matrx-print-accent, #2563eb);
}

.matrx-flashcards-print {
    margin: 1em 0 1.2em;
}
.matrx-fc {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin-bottom: 0.5em;
    border: 1px solid var(--matrx-print-border, #e5e7eb);
    border-radius: 6px;
}
.matrx-fc-front,
.matrx-fc-back {
    padding: 0.6em 0.8em;
}
.matrx-fc-front {
    font-weight: 600;
    border-right: 1px dashed var(--matrx-print-border-muted, #d1d5db);
}
.matrx-fc-num {
    display: inline-block;
    min-width: 1.6em;
    font-size: 0.85em;
    color: var(--matrx-print-fg-subtle, #6b7280);
}

@media print {
    .matrx-page-break {
        margin: 0;
        border: 0;
        break-after: page;
        page-break-after: always;
    }
    .matrx-page-break::after {
        content: none;
    }
    .matrx-page-break + * {
        margin-top: 0;
    }

    /* Scoped to the rendered markdown (.matrx-content-container = document
       skin, .content = print window) so a host page that carries this sheet
       — a WordPress theme — keeps its own print rules everywhere else. */

    /* Long tables flow across pages: the header row repeats, rows never split. */
    :is(.matrx-content-container, .content) thead {
        display: table-header-group;
    }
    :is(.matrx-content-container, .content) :is(tr, img, figure),
    .matrx-fc,
    .matrx-task-item {
        break-inside: avoid;
        page-break-inside: avoid;
    }
    :is(.matrx-content-container, .content) :is(h1, h2, h3, h4, h5, h6),
    .matrx-artifact-header {
        break-after: avoid;
        page-break-after: avoid;
        break-inside: avoid;
    }

    /* Paper cannot scroll: long code lines wrap instead of being cut off. */
    :is(.matrx-content-container, .content) :is(pre, pre code) {
        white-space: pre-wrap !important;
        overflow-wrap: anywhere;
        overflow: visible !important;
    }
    .code-block-wrapper,
    .matrx-artifact {
        overflow: visible;
    }
    :is(.matrx-content-container, .content) img {
        max-width: 100% !important;
    }

    .matrx-artifact-header,
    .matrx-task-box {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    a.matrx-link[href^="http"]::after {
        content: " (" attr(href) ")";
        font-size: 0.85em;
        color: var(--matrx-print-fg-subtle, #6b7280);
        overflow-wrap: anywhere;
    }
}
`,xe=`
@page {
    margin: 0.6in 0.65in 0.7in;
    @bottom-center {
        content: counter(page) " / " counter(pages);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 8pt;
        color: var(--matrx-print-fg-subtle, #6b7280);
    }
}
`,Se=`
@page {
    margin: 0.6in 0.65in 0.7in;
}
`,Ce=`<!-- pagebreak -->`,we=`matrx-page-break`,Te=`Page break`,Ee=/^<!--\s*(?:page[\s_-]?break|new[\s_-]?page)\s*-->$/i,De=/^\\(?:pagebreak|newpage|clearpage)\s*(?:\{\s*\})?$/i,Oe=/^<div\b([^>]*)>\s*<\/div>$|^<div\b([^>]*)\/>$/i,ke=/(?:page-break-(?:after|before)\s*:\s*always|break-(?:after|before)\s*:\s*page|class\s*=\s*["'](?:[^"']*\s)?page-?break(?:\s[^"']*)?["'])/i;function N(e){let t=0;for(let n of e)if(n===` `||n===`\xA0`)t+=1;else if(n===`	`)t+=4;else break;return t}function Ae(e){if(N(e)>=4)return!1;let t=e.trim();if(t.length<8||t.length>200)return!1;if(Ee.test(t)||De.test(t))return!0;let n=Oe.exec(t);return n?ke.test(n[1]??n[2]??``):!1}var je=/^<!--\s*section(?:[\s_-]?break)?\b\s*:?\s*([^>]*?)\s*-->$/i;function Me(e){if(N(e)>=4)return null;let t=je.exec(e.trim());if(!t)return null;let n=(t[1]??``).toLowerCase(),r={};/\blandscape\b/.test(n)?r.orientation=`landscape`:/\bportrait\b/.test(n)&&(r.orientation=`portrait`);let i=/\b(?:columns?|cols?)\s*[=:]\s*(\d)\b/.exec(n)??/\b(\d)\s*[-\s]?columns?\b/.exec(n);return i&&(r.columns=Math.min(3,Math.max(1,Number(i[1])))),r}var Ne=/^(?:\[\[\s*toc\s*\]\]|\[toc\]|\$\{toc\}|<!--\s*toc\s*-->|\\tableofcontents)$/i,Pe=/^(?:\[\[\s*(?:bibliography|references)\s*\]\]|<!--\s*(?:bibliography|references)\s*-->|\\printbibliography|\\bibliography\{[^}]*\})$/i;function Fe(e){return N(e)<4&&Ne.test(e.trim())}function Ie(e){return N(e)<4&&Pe.test(e.trim())}function Le(e){return Ae(e)||Me(e)!==null}function Re(e){let t=e.split(/\r?\n/),n=[],r=[],i=null;for(let e of t){let t=/^\s*(`{3,}|~{3,})/.exec(e);if(t){let e=t[1];i===null?i=e:e[0]===i[0]&&e.length>=i.length&&(i=null)}else if(i===null&&Le(e)){r.join(`
`).trim()&&n.push(r.join(`
`)),r=[];continue}r.push(e)}return(r.join(`
`).trim()||n.length===0)&&n.push(r.join(`
`)),n}function P(e){return`${e.source}\0${e.type}\0${e.body}`}function ze(e){return`svg`in e?Ve(e):te(e)}function Be(e,t=`article`){let n=new Map;return Q(e,t,{renderBlock:e=>(n.set(P(e),e),null)}),[...n.values()]}function Ve(e){let t=new TextEncoder().encode(e.svg),n=``;for(let e=0;e<t.length;e++)n+=String.fromCharCode(t[e]);return`<figure class="matrx-fence-picture"><img src="${`data:image/svg+xml;base64,${btoa(n)}`}" alt="${g(e.alt??`Diagram`)}"></figure>`}function F(t){return e(t)}function He(e){return e?/<thinking>|<think>|<reasoning>/i.test(e):!1}var I=``,Ue=``,We=e=>`${I}B${e}${Ue}`,Ge=e=>`${I}I${e}${Ue}`,Ke=/\uE000([BI])(\d+)\uE001/g,qe=/<p[^>]*>\s*(\uE000B\d+\uE001)\s*<\/p>/g,Je=class{items=[];block(e){return We(this.items.push(e)-1)}inline(e){return Ge(this.items.push(e)-1)}restore(e){let t=e;for(let e=0;e<8&&t.includes(I);e++)t=t.replace(qe,`$1`).replace(Ke,(e,t,n)=>this.items[Number(n)]??``);return Ft(t)}},Ye={skin:`document`,table:`matrx-table`,thead:`matrx-table-head`,tbody:`matrx-table-body`,tr:`matrx-table-row`,th:`matrx-table-header`,td:`matrx-table-cell`,ul:`matrx-list matrx-bullet-list`,ol:`matrx-list matrx-numbered-list`,ulNested:`matrx-list matrx-bullet-list matrx-nested-list`,olNested:`matrx-list matrx-numbered-list matrx-nested-list`,li:`matrx-list-item`,hr:`matrx-hr`,del:`matrx-del`,strong:`matrx-strong`,em:`matrx-em`,inlineCode:`matrx-inline-code`,blockquote:`matrx-blockquote`},Xe={skin:`article`,table:`print-table`,thead:``,tbody:``,tr:``,th:``,td:``,ul:``,ol:``,ulNested:``,olNested:``,li:``,hr:``,del:``,strong:``,em:``,inlineCode:`inline-code`,blockquote:``},L=(...e)=>{let t=e.filter(Boolean).join(` `);return t?` class="${t}"`:``},Ze=`<div class="${we}" role="separator" aria-label="${Te}" data-label="${Te}"></div>`;function R(e,t,n){let r=g(t.replace(/\n$/,``)),i=n.trim();return e.skin===`article`?`<div class="code-block-wrapper">${i?`<span class="code-lang">${g(i)}</span>`:``}<pre class="code-block"><code>${r}</code></pre></div>`:`<pre class="matrx-code-block"${i?` data-language="${g(i)}"`:``}><code class="matrx-code">${r}</code></pre>`}var z={html:`html`,react:`tsx`,svg:`svg`,mermaid:`mermaid`,diff:`diff`,iframe:`html`,code:``},Qe={html:`HTML`,svg:`SVG`,react:`React`,iframe:`Embed`};function $e(e){let t={};for(let n of e.matchAll(/([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))t[n[1].toLowerCase()]=n[2]??n[3]??``;return t}function et(e){return e?Qe[e]??e.replace(/[-_]+/g,` `).replace(/\b\w/g,e=>e.toUpperCase()):`Artifact`}function tt(e){return/<artifact\b/i.test(e)?e.split(/(^[ \t]*(?:`{3,}|~{3,})[\s\S]*?^[ \t]*(?:`{3,}|~{3,})[ \t]*$)/m).map((e,t)=>t%2==1?e:e.replace(/<artifact\b((?:[^>"']|"[^"]*"|'[^']*')*?)>([\s\S]*?)<\/artifact>/gi,(e,t,n)=>{let r=$e(t),i=(r.type??``).toLowerCase(),a=n.replace(/^\n+|\n+$/g,``);return a.trim()?/^\s*(`{3,}|~{3,})/.test(a)?`

${a}

`:i in z?`

\`\`\`\`${z[i]||r.language||r.lang||``}
${a}
\`\`\`\`

`:nt(a)?`

\`\`\`\`json
${JSON.stringify(JSON.parse(a),null,2)}
\`\`\`\`

`:`

${a}

`:``})).join(``):e}function nt(e){let t=e.trim();if(!/^[[{]/.test(t))return!1;try{return JSON.parse(t),!0}catch{return!1}}function rt(e,t,n,r){let i=(t.type??``).toLowerCase(),a=t.title?.trim()??``,o=`<div class="matrx-artifact-header"><span class="matrx-artifact-kind">${g(et(i))}</span>${a?`<span class="matrx-artifact-title">${g(a)}</span>`:``}</div>`,s,c=(n??``).replace(/^\n+|\n+$/g,``),l=n!==null&&c.trim()?r.options.renderBlock?.({source:`artifact`,type:i,body:c,attributes:t,...a?{title:a}:{}}):null;return s=l?ze(l):n===null||!c.trim()?`<p class="matrx-artifact-empty">Saved artifact — open it in AI Matrx to view its content.</p>`:/^\s*(`{3,}|~{3,})/.test(c)?Vt(e.skin,c,r):i in z?R(e,c,z[i]||t.language||t.lang||``):nt(c)?R(e,JSON.stringify(JSON.parse(c),null,2),`json`):Vt(e.skin,c,r),`<section class="matrx-artifact" data-artifact-type="${g(i||`artifact`)}">${o}<div class="matrx-artifact-body">${s}</div></section>`}function it(e,t){let n=[];for(let r of e.split(/\n*---\n*/g).map(e=>e.trim()).filter(Boolean)){let e=r.match(/Front:\s*(.+?)(?=\n|$)/i)?.[1]?.trim(),i=r.match(/Back:\s*([\s\S]+?)$/i)?.[1]?.trim();!e||!i?t?.({code:`flashcard-malformed`,message:`A flashcard was skipped: it is missing a ${e?`Back:`:`Front:`} line.`,remedy:`Every card inside <flashcards> needs both "Front: …" and "Back: …", separated from the next card by ---.`}):n.push({front:e,back:i})}return n}function at(e,t,n){if(e.skin===`article`)return`<div class="matrx-flashcards-print">${t.map((e,t)=>`<div class="matrx-fc"><div class="matrx-fc-front"><span class="matrx-fc-num">${t+1}</span>${e.front}</div><div class="matrx-fc-back">${e.back}</div></div>`).join(``)}</div>`;let r=`<div class="matrx-flashcards-container">
`;for(let{front:e,back:i}of t){n.cardIndex++;let t=`card${n.cardIndex}`;r+=`    <div class="matrx-flashcard">
        <input type="checkbox" class="matrx-flashcard-input" id="${t}">
        <label for="${t}" class="matrx-flashcard-label"></label>
        <div class="matrx-flashcard-inner">
            <div class="matrx-flashcard-front">
                <div class="matrx-flashcard-content">
                    <strong>${e}</strong>
                </div>
                <span class="matrx-flashcard-indicator">CLICK TO FLIP</span>
            </div>
            <div class="matrx-flashcard-back">
                <div class="matrx-flashcard-content">
                    ${i}
                </div>
                <span class="matrx-flashcard-indicator">CLICK TO FLIP</span>
            </div>
        </div>
    </div>

`}return`${r}</div>
`}var ot=/^(\s*)(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;function st(e,t,r,o){let{text:s,spans:l}=ve(e),d=s.replace(ge,(e,t)=>{let n=l[Number(t)];return n?n.display?r.block(_t(n)):r.inline(_t(n)):``}),p=c(d),h=Pt(d,p),_=f(h),ee=new Set(m(h)),v=h.split(`
`).map((e,t)=>{let n=e.replace(/\r$/,``);return ee.has(t)?``:p[t]!==`prose`||_.size===0?n:a(n,_)}),y=It(v,p,t,r),b=[];for(let e=0;e<v.length;e++){let a=v[e],s=ot.exec(a);if(s){let n=s[2],i=[],a=e+1;for(;a<v.length;a++){let e=/^\s*(`{3,}|~{3,})\s*$/.exec(v[a]);if(e&&e[1][0]===n[0]&&e[1].length>=n.length)break;i.push(v[a])}let c=s[1].length,l=i.map(e=>e.slice(Math.min(c,e.length-e.trimStart().length))),u=o.options.renderBlock?.({source:`fence`,type:(s[3]??``).trim().toLowerCase(),body:l.join(`
`)});b.push(r.block(u?ze(u):R(t,l.join(`
`),s[3]??``))),e=a;continue}if(Le(a)){b.push(r.block(Ze));continue}if(Fe(a)||Ie(a))continue;let c=/^\s*<artifact\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>(.*)$/i.exec(a);if(c){let n=$e(c[1]??``);if(c[2]===`/`){b.push(r.block(rt(t,n,null,o))),c[3]?.trim()&&b.push(c[3]);continue}let i=[],a=c[3]??``,s=``,l=e,u=null;for(;;){let e=u?-1:a.search(/<\/artifact\s*>/i);if(e>=0){i.push(a.slice(0,e)),s=a.slice(e).replace(/^<\/artifact\s*>/i,``);break}i.push(a);let t=/^\s*(`{3,}|~{3,})/.exec(a);if(t){let e=t[1];u===null?u=e:e[0]===u[0]&&e.length>=u.length&&(u=null)}if(l++,l>=v.length)break;a=v[l]}let d=o.depth>=3?R(t,i.join(`
`),``):rt(t,n,i.join(`
`),{...o,depth:o.depth+1});b.push(r.block(d)),s.trim()&&b.push(s),e=l;continue}if(n(a)>=4&&a.trim()&&Ct(v,e)){let i=e;for(;i<v.length&&(!(v[i]??``).trim()||n(v[i]??``)>=4);)i+=1;for(;i>e&&!(v[i-1]??``).trim();)--i;let a=v.slice(e,i).map(e=>e.replace(/^(?: {4}|\t| {1,3}\t)/,``));b.push(r.block(R(t,a.join(`
`),``))),e=i-1;continue}let l=Lt(v,e);if(l){let n=`<blockquote${L(t.blockquote)}>`.repeat(l.depth),i=`</blockquote>`.repeat(l.depth);b.push(r.block(`${n}${Rt(l.rows,t,r)}${i}`)),e=l.end-1}else if(u(v,e)){let n=i(v,e);b.push(r.block(Rt(v.slice(e,n),t,r))),e=n-1}else b.push(a)}y&&b.push(``,r.block(y));let x=Ft(b.join(`
`));x=x.replace(/`([^`\n]+)`/g,(e,n)=>r.inline(`<code${L(t.inlineCode)}>${g(n)}</code>`)),x=x.split(`
`).map(e=>e.replace(bt,``).startsWith(`<`)?e:e.replace(K,(e,t)=>xt(t)?``:e)).join(`
`),x=yt(x,r),x=x.replace(/<!--[\s\S]*?-->/g,``);let S=x;for(let e=0;e<8;e++){let e=x.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,``).replace(/<\/?(?:script|style|head|html|body)\b[^>]*>/gi,``).replace(/<!DOCTYPE[^>]*>/gi,``);if(e===x)break;x=e}return x=ft(x),(x!==S||lt(x))&&!o.strippedAnnounced&&(o.strippedAnnounced=!0,o.options.onNotice?.({code:`html-stripped`,message:`Markup that is not on the safe list (a <script>, <style>, <iframe>, <form>, <object>/<embed>, <meta>, <link>, an on… event handler, inline style, or a javascript: URL) was removed from the rendered copy.`,remedy:'To show a full HTML page, put it in an ```html fence or an <artifact type="html"> block — it is printed as its source.'})),x=x.replace(/<flashcards>([\s\S]*?)<\/flashcards>/gi,(e,n)=>{let i=it(n,o.options.onNotice);return i.length?`
${r.block(at(t,i,o))}
`:``}),x}var ct=new Set(D.tagNames??[]);function lt(e){for(let t of e.matchAll(/<\/?([a-zA-Z][\w:-]*)/g)){let e=t[1].toLowerCase();if(e!==`flashcards`&&!ct.has(e))return!0}return!1}var ut=new Set([`href`,`src`,`action`,`formaction`,`xlink:href`,`poster`,`background`]);function dt(e){return e.replace(/&#x([0-9a-f]+);?/gi,(e,t)=>String.fromCharCode(parseInt(t,16))).replace(/&#(\d+);?/g,(e,t)=>String.fromCharCode(Number(t))).replace(/&colon;/gi,`:`).replace(/[\u0000-\u0020]+/g,``).toLowerCase()}function ft(e){return e.replace(/<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,(e,t,n)=>{if(!/[=\s]/.test(n))return e;let r=!1,i=n.replace(/(\s+)([^\s"'=<>/]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,(e,t,n,i,a,o,s)=>{let c=n.toLowerCase();if(c.startsWith(`on`)||c===`srcdoc`)return r=!0,``;if(ut.has(c)){let e=dt(a??o??s??``);if(/^(?:javascript|vbscript):|^data:text\/html/.test(e))return r=!0,` ${n}="#"`}return e});return r?`<${t}${i}>`:e})}function B(e){let t=e.trim();return/^(?:javascript|vbscript):|^data:text\/html/.test(dt(t))?`#`:t.replace(/"/g,`%22`)}function V(e,t){let n=`<strong${L(t.strong)}>`,r=`<em${L(t.em)}>`;return e.replace(/\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*/g,`${n}${r}$1</em></strong>`).replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g,`${n}$1</strong>`).replace(/(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])/g,`${r}$1</em>`).replace(/(?<![\w_])___(?!\s)(.+?)(?<!\s)___(?![\w_])/g,`${n}${r}$1</em></strong>`).replace(/(?<![\w_])__(?!\s)(.+?)(?<!\s)__(?![\w_])/g,`${n}$1</strong>`).replace(/(?<![\w_])_(?![\s_])(.+?)(?<![\s_])_(?![\w_])/g,`${r}$1</em>`).replace(/~~(?!\s)(.+?)(?<!\s)~~/g,`<del${L(t.del)}>$1</del>`)}var H=String.raw`((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?`,U=new RegExp(String.raw`!\[([^\]]*)\]\(`+H+String.raw`\)`,`g`),W=new RegExp(String.raw`\[([^\]]+)\]\(`+H+String.raw`\)`,`g`);function pt(e,t){return e.replace(/^\s{0,3}#\s*={3,}\s*$/gm,`<hr${L(t.hr,`matrx-hr-heavy`)}>`).replace(/^\s{0,3}\*(?:\s*\*){2,}\s*$/gm,`<hr${L(t.hr,`matrx-hr-accent`)}>`).replace(/^\s{0,3}(?:-\s*){3,}$/gm,`<hr${L(t.hr)}>`).replace(/^\s{0,3}(?:_\s*){3,}$/gm,`<hr${L(t.hr)}>`)}function mt(e){let t=e.trim(),n=t.startsWith(`:`),r=t.endsWith(`:`);return n&&r?` style="text-align:center"`:r?` style="text-align:right"`:``}function ht(e){let t=G;return G=[],pe(e).replace(gt,(e,n)=>t[Number(n)]??``)}var G=[],gt=/\uE017(\d+)\uE018/g;function _t(e){return`\uE017${G.push(ye(e.tex,e.display))-1}\uE018`}var vt=/\\([!-\/:-@[-`{-~])/g;function yt(e,t){return e.replace(vt,(e,n)=>t.inline(g(n)))}var K=/<\/?([A-Za-z][\w-]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/g,bt=/^\s*(?:>\s*)*(?:(?:[-+*]|\d{1,9}[.)])\s+)?/,xt=e=>l(e)||/^(?:thead|tbody|tfoot|tr|td|th|caption|colgroup|col|li|dt|dd)$/i.test(e);function St(e,n,r){let i=t(d(e),(e,t)=>r.inline(`<code${L(n.inlineCode)}>${g(s(t))}</code>`));return i=i.replace(K,(e,t)=>xt(t)?``:e),i=yt(i,r),i=i.replace(U,(e,t,i)=>r.inline(`<img class="${n.skin===`document`?`matrx-image`:`print-image`}" src="${B(i)}" alt="${g(t)}" />`)),i=i.replace(W,(e,t,i)=>r.inline(`<a${n.skin===`document`?` class="matrx-link"`:``} href="${B(i)}">${V(t,n)}</a>`)),V(i,n)}function Ct(e,t){if(t>0&&(e[t-1]??``).trim())return!1;let r=t-1;for(;r>=0&&!(e[r]??``).trim();)--r;if(r<0)return!0;let i=e[r]??``;return n(i)===0&&!/^\s*(?:[-+*]|\d{1,9}[.)])\s/.test(i)}var wt=/^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/,Tt=/\[\^([^\]\s]+)\](?!:)/g,Et=/^ {0,3}(?:[-+*]\s|\d{1,9}[.)]\s|>|#{1,6}\s|\||```|~~~|\[\^[^\]\s]+\]:)/,Dt=/^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;function Ot(e){if(Et.test(e)||Dt.test(e))return!0;let t=e.trim();if(/^<(?:!--|\?|![A-Za-z]|!\[CDATA\[)/.test(t))return!0;let n=/^<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:[\s>]|\/>|$)/.exec(t);return!n||!l(n[2])?!1:!(n[1]&&/^(?:script|pre|style|textarea)$/i.test(n[2]))}var kt=/\uE013(\d+)\uE013/g,q=/\uE000I\d+\uE001/g;function J(e,t,n,r){let i=1;for(let a=t+1;a<e.length;a+=1)if(e[a]===`\\`)a+=1;else if(e[a]===n)i+=1;else if(e[a]===r&&--i===0)return a;return-1}function At(e,t){let n=``;for(let r=0;r<e.length;){let i=e.startsWith(`![`,r);if(!(i||e[r]===`[`)){n+=e[r]??``,r+=1;continue}let a=J(e,r+ +!!i,`[`,`]`);if(a<0||e[a+1]!==`(`){n+=e[r]??``,r+=1;continue}let o=J(e,a+1,`(`,`)`);o<0?(n+=e[r]??``,r+=1):(n+=i?t(e.slice(r,o+1)):`${e.slice(r,a+2)}${t(e.slice(a+2,o))})`,r=o+1)}return n}function jt(e,t,n){let r=``;for(let i=0;i<e.length;){if(e[i]!==`[`||e[i-1]===`!`){r+=e[i]??``,i+=1;continue}let a=J(e,i,`[`,`]`);if(a<0||e[a+1]!==`(`){r+=e[i]??``,i+=1;continue}let o=J(e,a+1,`(`,`)`);if(o<0){r+=e[i]??``,i+=1;continue}let s=e.slice(i+1,a);if(!q.test(s)){q.lastIndex=0,r+=e.slice(i,o+1),i=o+1;continue}q.lastIndex=0;let c=e.slice(a+2,o),l=B(c.match(RegExp(`^${H}$`))?.[1]??c);for(let e of s.split(/(\uE000I\d+\uE001)/g))e&&(r+=q.test(e)?e:n.inline(`<a${t.skin===`document`?` class="matrx-link"`:``} href="${l}">${V(g(e),t)}</a>`),q.lastIndex=0);i=o+1}return r}var Mt=``,Nt=/<\/?[A-Za-z][\w-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;function Pt(e,n){let r=e=>e.replaceAll(`[^`,Mt),i=e=>{let n=[];return t(e,(e,t)=>`\uE015${n.push(t)-1}\uE016`).replace(/<!--[\s\S]*?(?:-->|$)/g,r).replace(/<(script|style|head)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,r).replace(Nt,r).replace(/\uE015(\d+)\uE016/g,(e,t)=>n[Number(t)]??``)},a=e.split(`
`);for(let e=0;e<a.length;){if(n[e]!==`prose`){e+=1;continue}let t=e+1;for(;t<a.length&&n[t]===`prose`;)t+=1;let r=i(a.slice(e,t).join(`
`)).split(`
`);a.splice(e,t-e,...r),e=t}return a.join(`
`)}function Ft(e){return e.replaceAll(Mt,`[^`)}function It(e,n,r,i){if(!e.some(e=>e.includes(`[^`)))return``;let a=new Map;for(let t=0;t<e.length;t+=1){if(n[t]!==`prose`)continue;let r=wt.exec(e[t]??``);if(!r)continue;let i=r[1].toLowerCase(),o=[[r[2]??``]],s=e[t]??``;e[t]=``;let c=t+1;for(;c<e.length&&n[c]===`prose`;c+=1){let t=e[c]??``;if(/^(?: {4}|\t)/.test(t))o[o.length-1].push(t.replace(/^(?: {4}|\t)/,``));else if(t.trim()&&s.trim()&&!Ot(t))o[o.length-1].push(t);else if(!t.trim()&&/^(?: {4}|\t)\S/.test(e[c+1]??``))o.push([]);else break;s=t,e[c]=``}a.has(i)||a.set(i,o.filter(e=>e.length)),t=c-1}if(a.size===0)return``;let o=new Map,s=new Map,c=e=>{if(!e.includes(`[^`))return e;let n=[],c=t(e,(e,t)=>`\uE012${n.push(t)-1}\uE012`),l=[],u=e=>`\uE013${l.push(e)-1}\uE013`;return jt(At(c.replace(K,e=>u(e)),u).replace(Tt,(e,t,n,r)=>{let c=0;for(let e=n-1;e>=0&&r[e]===`\\`;--e)c+=1;if(c%2==1)return e;let l=t.toLowerCase();if(!a.has(l))return e;o.has(l)||o.set(l,o.size+1);let u=o.get(l),d=(s.get(l)??0)+1;s.set(l,d);let f=d===1?`fnref-${u}`:`fnref-${u}-${d}`;return i.inline(`<sup class="print-footnote-ref"><a href="#fn-${u}" id="${f}">${u}</a></sup>`)}).replace(kt,(e,t)=>l[Number(t)]??``).replace(/\uE012(\d+)\uE012/g,(e,t)=>n[Number(t)]??``),r,i)};for(let t=0;t<e.length;t+=1)n[t]===`prose`&&(e[t]=c(e[t]));let l=[],u=(e,t)=>{let n=(a.get(t)??[]).map(e=>`<p>${St(c(e.join(` `)),r,i)}</p>`).join(``);l.push(`<li id="fn-${e}" value="${e}">${n}</li>`)};for(let[e,t]of o)u(t,e);return l.length===0?``:`<section class="print-footnotes"><hr /><ol>${l.join(``)}</ol></section>`}var Y=/^(?: {0,3}> ?)+/,X=e=>(Y.exec(e)?.[0].match(/>/g)??[]).length;function Lt(e,t){let n=X(e[t]??``);if(n===0)return null;let r=t,a=[];for(;r<e.length&&X(e[r]??``)===n;)a.push((e[r]??``).replace(Y,``)),r+=1;let o=t;for(;o>0&&X(e[o-1]??``)===n;)--o;let s=e.slice(o,t).map(e=>e.replace(Y,``)),c=[...s,...a],l=s.length;if(!u(c,l))return null;let d=i(c,l);return{rows:c.slice(l,d),depth:n,end:t+(d-l)}}function Rt(e,t,n){let r=e=>o(e).map(e=>St(e,t,n)),i=r(e[0]??``),a=o(e[1]??``).map(mt),s=e.slice(2).map(e=>{let t=r(e);return i.map((e,n)=>t[n]??``)}),c=`<table${L(t.table)}>
<thead${L(t.thead)}>
<tr${L(t.tr)}>
`;if(i.forEach((e,n)=>{c+=`<th${L(t.th)}${a[n]??``}>${e}</th>
`}),c+=`</tr>
</thead>
`,s.length>0){c+=`<tbody${L(t.tbody)}>
`;for(let e of s)c+=`<tr${L(t.tr)}>
`,e.forEach((e,n)=>{c+=`<td${L(t.td)}${a[n]??``}>${e}</td>
`}),c+=`</tr>
`;c+=`</tbody>
`}return`${c}</table>`}var zt=/^(?:<\/?(?:h[1-6]|ul|ol|li|blockquote|pre|hr|table|thead|tbody|tr|th|td|div|figure|section)\b|\uE000B\d+\uE001$)/;function Bt(e,t){let n=e.split(`
`),r=``,i=[],a=``,o=`<li${L(t.li)}>`,s=()=>i[i.length-1],c=(e,n)=>e===`ol`?`<ol${L(n?t.olNested:t.ol)}>
`:`<ul${L(n?t.ulNested:t.ul)}>
`,l=()=>{a&&=(r+=`</li>
`,``);let e=i.pop();e&&(r+=e.type===`ol`?`</ol>
`:`</ul>
`,i.length>0&&(r+=`</li>
`))},u=e=>{for(;i.length>0&&s().indent>e;)l()},d=0,f=!1,p=e=>e.length-e.trimStart().length;for(let e of n){let t=e.match(/^(\s*)(\d+)[.)]\s+(.+)$/),n=t?null:e.match(/^(\s*)[*\-+]\s+(.+)$/);if(t||n){let l=t?`ol`:`ul`,p=(t??n)[1]?.length??0,m=(t?t[3]:n[2])??``,h=s();if(h&&p>h.indent)r+=`
${c(l,!0)}`,i.push({type:l,indent:p});else{u(p),a&&s()?.indent===p&&(r+=`</li>
`);let e=s();if(e&&e.indent===p&&e.type!==l){let e=i.pop();r+=e.type===`ol`?`</ol>
`:`</ul>
`}let t=s();(!t||t.indent!==p||t.type!==l)&&(r+=c(l,i.length>0),i.push({type:l,indent:p}))}r+=`${o}${m}`,a=l,d=e.length-m.length,f=!1;continue}let m=e.trim();if(m===``)f=!0,r+=`${e}
`;else{if(a&&!zt.test(m)){if(!f){r+=` ${m}`;continue}if(p(e)>=d){r+=`${m}
`;continue}}for(;i.length>0;)l();r+=`${e}
`}}for(;i.length>0;)l();return r.replace(/<li( class="([^"]*)")?>\s*\[([ xX])\]\s+/g,(e,t,n,r)=>`<li${L(n??``,`matrx-task-item`)}><span class="matrx-task-box${r===` `?``:` is-checked`}" aria-hidden="true"></span>`)}function Vt(e,t,n){return e===`article`?qt(t,n):Gt(t,n)}function Ht(e){return e.replace(/[\uE000-\uE018]/g,``)}function Ut(e){return{options:e,depth:0,cardIndex:0,strippedAnnounced:!1}}function Wt(e,t={}){if(!e)return t.onNotice?.({code:`empty-output`,message:`markdownToHtml received an empty string.`,remedy:`Check the content is loaded before converting; nothing was rendered.`}),``;let n=Ht(t.includeThinking?e:F(e));return G=[],ht(`<div class="matrx-content-container">${Gt(n,Ut(t))}</div>`)}function Gt(e,t){let n=Ye,r=new Je,i=st(e,n,r,t);return i=pt(i,n),i=i.replace(U,(e,t,n)=>r.block(`<img class="matrx-image" src="${B(n)}" alt="${g(t)}" />`)),i=i.replace(W,(e,t,i)=>r.inline(`<a class="matrx-link" href="${B(i)}">${V(t,n)}</a>`)),i=i.replace(/^# (.+)$/gm,`<h1 class="matrx-h1">$1</h1>`).replace(/^## (.+)$/gm,`<h2 class="matrx-h2">$1</h2>`).replace(/^### (.+)$/gm,`<h3 class="matrx-h3">$1</h3>`).replace(/^#### (.+)$/gm,`<h4 class="matrx-h4">$1</h4>`).replace(/^##### (.+)$/gm,`<h5 class="matrx-h5">$1</h5>`).replace(/^###### (.+)$/gm,`<h6 class="matrx-h6">$1</h6>`),i=Bt(i,n),i=V(i,n),i=i.replace(/^> ?(.+)$/gm,`<blockquote class="matrx-blockquote">$1</blockquote>`),i=i.replace(/<table>/g,`<table class="matrx-table">`).replace(/<thead>/g,`<thead class="matrx-table-head">`).replace(/<tbody>/g,`<tbody class="matrx-table-body">`).replace(/<tr>/g,`<tr class="matrx-table-row">`).replace(/<th>/g,`<th class="matrx-table-header">`).replace(/<td>/g,`<td class="matrx-table-cell">`),i=i.replace(/<img(?![^>]*class=)([^>]*)>/g,`<img class="matrx-image"$1>`),i=i.replace(/<div\b([^>]*)>/g,(e,t)=>/\bclass="matrx-/.test(t)?e:/\bclass="/.test(t)?`<div${t.replace(/\bclass="/,`class="matrx-div `)}>`:`<div class="matrx-div"${t}>`),i=i.replace(/<span(?![^>]*class=)([^>]*)>/g,`<span class="matrx-span"$1>`),i=i.replace(/^([^<\n].+)$/gm,`<p class="matrx-paragraph">$1</p>`),i=i.replace(/<\/p>\s*<p class="matrx-paragraph">/g,`</p><p class="matrx-paragraph">`),i=i.replace(/(<h1 class="matrx-h1">[\s\S]*?<\/h1>\s*)<p class="matrx-paragraph">((?:(?!\uE000B)[\s\S])*?)<\/p>/g,`$1<p class="matrx-intro">$2</p>`),i=i.replace(/^<strong class="matrx-strong">([^<]*\?[^<]*)<\/strong>$/gm,`<h3 class="matrx-h3">$1</h3>`),i=i.replace(/<p class="matrx-paragraph"><strong class="matrx-strong">([^<]*\?[^<]*)<\/strong><\/p>/g,`<h3 class="matrx-h3">$1</h3>`),i=i.replace(/<h3 class="matrx-h3">([^<]*\?[^<]*)<\/h3>/g,`<div class="matrx-faq-question">$1</div>`),i=i.replace(/(<div class="matrx-faq-question">[^<]*<\/div>)\s*(<p class="matrx-paragraph">[\s\S]*?<\/p>)/g,`<div class="matrx-faq-item">$1<div class="matrx-faq-answer">$2</div></div>`),i=i.replace(/(<div class="matrx-faq-question">[^<]*<\/div>)(?!\s*<div class="matrx-faq-answer">)/g,`<div class="matrx-faq-item">$1<div class="matrx-faq-answer"></div></div>`),i=i.replace(/(<div class="matrx-faq-answer">)<p class="matrx-paragraph">([\s\S]*?)<\/p>(<\/div>)/g,`$1$2$3`),r.restore(i)}function Kt(e,t={}){if(!e)return t.onNotice?.({code:`empty-output`,message:`markdownToArticleHtml received an empty string.`,remedy:`Check the content is loaded before printing; nothing was rendered.`}),``;let n=Ht(t.includeThinking?e:F(e));return G=[],ht(qt(n,Ut(t)))}function qt(e,t){let n=Xe,r=new Je,i=st(e,n,r,t);return i=pt(i,n),i=i.replace(U,(e,t,n)=>r.block(`<figure class="print-figure"><img class="print-image" src="${B(n)}" alt="${g(t)}" />${t?`<figcaption>${g(t)}</figcaption>`:``}</figure>`)),i=i.replace(W,(e,t,i)=>r.inline(`<a href="${B(i)}">${V(t,n)}</a>`)),i=i.replace(/^#{6}\s+(.+)$/gm,`<h6>$1</h6>`).replace(/^#{5}\s+(.+)$/gm,`<h5>$1</h5>`).replace(/^#{4}\s+(.+)$/gm,`<h4>$1</h4>`).replace(/^#{3}\s+(.+)$/gm,`<h3>$1</h3>`).replace(/^#{2}\s+(.+)$/gm,`<h2>$1</h2>`).replace(/^#{1}\s+(.+)$/gm,`<h1>$1</h1>`),i=i.replace(/^> ?(.+)$/gm,`<blockquote>$1</blockquote>`),i=Bt(i,n),i=V(i,n),i=i.split(`
`).map(e=>{let t=e.trim();return t?/^<\/?(h[1-6]|ul|ol|li|blockquote|pre|hr|table|thead|tbody|tr|th|td|div|figure|section)/.test(t)||/^\uE000B\d+\uE001$/.test(t)?e:`<p>${t}</p>`:``}).join(`
`),r.restore(i).replace(/\n{3,}/g,`

`).trim()}var Jt=`
.print-actions { display: flex; gap: 10px; margin: 0 auto 28px; max-width: 800px; padding: 0 2rem 20px; border-bottom: 2px solid var(--matrx-print-border, #e1e1e1); }
.print-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 20px; border-radius: 8px; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; border: none; font-weight: 600; }
.print-btn-primary { background: var(--matrx-print-accent, #667eea); color: var(--matrx-print-bg, #ffffff); }
.print-btn-secondary { background: var(--matrx-print-surface, #f8f9fa); color: var(--matrx-print-fg-strong, #374151); border: 1px solid var(--matrx-print-border-muted, #d1d5db); }
@media print { .print-actions { display: none !important; } }
`;function Z(e={}){return[(e.skin??`document`)===`article`?`${k}
${j}`:`${be}
${A}`,M,S,e.pageNumbers===!1?Se:xe,e.tokens??``,e.extraCss??``].filter(e=>e.trim().length>0).join(`
`)}function Q(e,t,n={}){return t===`article`?Kt(e,n):Wt(e,n)}function $(e,t={}){let n=t.skin??`document`,r=t.title??`AI Response`,i=(t.convertToHtml??(e=>Q(e,n,{...t.onNotice?{onNotice:t.onNotice}:{},...t.renderBlock?{renderBlock:t.renderBlock}:{}})))(e),a=t.css??Z({skin:n,...t.tokens===void 0?{}:{tokens:t.tokens},...t.extraCss===void 0?{}:{extraCss:t.extraCss}}),o=t.withPrintActions&&n!==`article`?Jt:``,s=t.withPrintActions?`<div class="print-actions"><button class="print-btn print-btn-primary" onclick="window.print()">Print / Save as PDF</button><button class="print-btn print-btn-secondary" onclick="window.close()">Close</button></div>`:``;return`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${g(r)}</title>
<style>${a}${o}</style></head>
<body>${s}<div class="content">${i}</div></body></html>`}function Yt(e,t={}){let n=t.title??`AI Response`,r=$(e,{...t,title:n,withPrintActions:t.withPrintActions??!0});return t.windowFeatures===void 0?re(r,n):re(r,n,t.windowFeatures)}async function Xt(e,t){let n=t.title??`AI Response`,r=ie(n,t.windowFeatures),{renderBlock:i,...a}=t,o=await Zt(e,a.skin??`document`,i),s=[...new Set([...o.values()].map(e=>`css`in e&&typeof e.css==`string`?e.css:``).filter(Boolean))].join(`
`),c=$(e,{...a,...s?a.css===void 0?{extraCss:`${a.extraCss??``}
${s}`}:{css:`${a.css}
${s}`}:{},renderBlock:e=>o.get(P(e))??null,title:n,withPrintActions:a.withPrintActions??!0});return r.write(c)}async function Zt(e,t,n){let r=new Map;return await Promise.all(Be(e,t).map(async e=>{try{let t=await n(e);t&&r.set(P(e),t)}catch(t){console.error(`[@ai-matrx/print] a block's print form failed`,t),r.set(P(e),{notice:`This ${e.type||`block`} could not be prepared for print.`})}})),r}export{j as MARKDOWN_ARTICLE_CSS,k as MARKDOWN_ARTICLE_TOKENS_CSS,A as MARKDOWN_DOCUMENT_CSS,be as MARKDOWN_DOCUMENT_TOKENS_CSS,xe as MARKDOWN_PAGE_CSS,M as MARKDOWN_SHARED_CSS,we as PAGE_BREAK_CLASS,Ce as PAGE_BREAK_MARKDOWN,Jt as PRINT_ACTIONS_CSS,Z as getMarkdownStylesheet,He as hasThinkingContent,Ae as isPageBreakLine,Be as listPrintBlocks,Kt as markdownToArticleHtml,Wt as markdownToHtml,Q as markdownToHtmlForSkin,P as printBlockKey,Yt as printMarkdown,Xt as printMarkdownWhenReady,F as removeThinkingContent,$ as renderMarkdownDocument,Zt as resolvePrintBlocks,Re as splitAtPageBreaks,tt as unwrapArtifactsToMarkdown};
//# sourceMappingURL=markdown-BixTJcdB.js.map