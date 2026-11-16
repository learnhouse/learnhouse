/**
 * Built-in looks of the page elements. Every rule sits in `:where()` (zero
 * specificity), so a node's own style class always wins. Colors, fonts and
 * radii come from the theme variables set on `.lhp-root`.
 */
export const BASE_CSS = `
.lhp-root{color-scheme:light;container-type:inline-size;container-name:lhp;color:var(--lhp-text);font-family:var(--lhp-font-body);line-height:1.55;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;width:100%;overflow-x:clip}
.lhp-root[data-scheme=dark]{color-scheme:dark}
.lhp-root *,.lhp-root *::before,.lhp-root *::after{box-sizing:border-box}
:where(.lhp-root) :where(section,header,footer,article,aside,nav,figure){margin:0}
:where(.lhp-root) :where(p,ul,ol,figure,blockquote,dl,dd){margin:0}
:where(.lhp-section){position:relative;width:100%}
:where(.lhp-bgvideo){position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;pointer-events:none}
:where(.lhp-h){font-family:var(--lhp-font-heading);font-weight:var(--lhp-heading-weight);line-height:1.15;letter-spacing:-.02em;margin:0;overflow-wrap:anywhere;text-wrap:balance}
:where(.lhp-h1){font-size:clamp(2.25rem,5.2cqi,3.75rem)}
:where(.lhp-h2){font-size:clamp(1.75rem,3.6cqi,2.5rem)}
:where(.lhp-h3){font-size:clamp(1.35rem,2.4cqi,1.75rem)}
:where(.lhp-h4){font-size:1.25rem}
:where(.lhp-h5){font-size:1.1rem}
:where(.lhp-h6){font-size:1rem}
:where(.lhp-text){white-space:pre-line;overflow-wrap:anywhere;margin:0}
:where(.lhp-img){display:block;max-width:100%;height:auto}
:where(.lhp-figure figcaption){font-size:.875rem;opacity:.65;text-align:center;margin-top:.75rem}
:where(.lhp-empty){display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:140px;width:100%;padding:28px 20px;border-radius:var(--lhp-radius);border:1.5px dashed var(--lhp-border);background:var(--lhp-surface);color:var(--lhp-muted);text-align:center;font-size:.9375rem}
:where(.lhp-empty p){margin:0;max-width:44ch}
:where(.lhp-ph){display:flex;align-items:center;justify-content:center;gap:.5rem;min-height:160px;width:100%;border-radius:var(--lhp-radius);background:repeating-linear-gradient(45deg,rgba(100,116,139,.06),rgba(100,116,139,.06) 10px,rgba(100,116,139,.12) 10px,rgba(100,116,139,.12) 20px);color:rgba(71,85,105,.9);font-size:.8125rem;font-weight:500;text-align:center;padding:1rem}
:where(.lhp-btn){display:inline-flex;align-items:center;justify-content:center;gap:.5em;font-weight:600;font-family:inherit;border-radius:var(--lhp-radius-btn);border:1.5px solid transparent;text-decoration:none;white-space:nowrap;cursor:pointer;transition:transform .15s ease,background-color .2s,color .2s,border-color .2s,box-shadow .2s,filter .2s;line-height:1;max-width:100%}
:where(.lhp-btn):hover{transform:translateY(-1px)}
:where(.lhp-btn[data-size=sm]){height:36px;padding:0 14px;font-size:.875rem}
:where(.lhp-btn[data-size=md]){height:44px;padding:0 20px;font-size:.9375rem}
:where(.lhp-btn[data-size=lg]){height:52px;padding:0 26px;font-size:1rem}
:where(.lhp-btn[data-full=true]){width:100%}
:where(.lhp-btn[data-variant=primary]){background:var(--lhp-primary);color:var(--lhp-on-primary);box-shadow:0 1px 2px rgba(15,23,42,.12)}
:where(.lhp-btn[data-variant=primary]):hover{filter:brightness(.94)}
:where(.lhp-btn[data-variant=secondary]){background:var(--lhp-background);color:var(--lhp-text);border-color:color-mix(in srgb,var(--lhp-text) 14%,transparent);box-shadow:0 1px 2px rgba(15,23,42,.08)}
:where(.lhp-btn[data-variant=outline]){background:transparent;color:inherit;border-color:currentColor}
:where(.lhp-btn[data-variant=ghost]){background:transparent;color:inherit}
:where(.lhp-btn[data-variant=ghost]):hover{background:rgba(127,127,127,.12)}
:where(.lhp-btn[data-variant=link]){background:transparent;color:var(--lhp-primary);padding:0;height:auto;text-decoration:underline;text-underline-offset:3px}
:where(.lhp-root[data-btn=soft]) :where(.lhp-btn[data-variant=primary]){background:color-mix(in srgb,var(--lhp-primary) 14%,transparent);color:var(--lhp-primary);box-shadow:none}
:where(.lhp-root[data-btn=outline]) :where(.lhp-btn[data-variant=primary]){background:transparent;color:inherit;border-color:currentColor;box-shadow:none}
:where(.lhp-divider){border:0;border-top:1px solid var(--lhp-border);width:100%;margin:0}
:where(.lhp-list){list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.6rem}
:where(.lhp-list li){display:flex;gap:.6rem;align-items:flex-start}
:where(.lhp-list .lhp-mark){flex:none;margin-top:.15em;color:var(--lhp-primary)}
:where(.lhp-list[data-marker=dot] .lhp-mark){width:.45em;height:.45em;border-radius:999px;background:currentColor;margin-top:.55em}
:where(.lhp-list[data-marker=number] .lhp-mark){font-weight:700;min-width:1.4em}
:where(.lhp-cols){display:grid;gap:32px;width:100%}
:where(.lhp-cols > *){min-width:0}
@container lhp (max-width:1023px){:where(.lhp-cols[data-stack=tablet]){grid-template-columns:minmax(0,1fr)!important}}
@container lhp (max-width:639px){:where(.lhp-cols[data-stack=tablet],.lhp-cols[data-stack=mobile]){grid-template-columns:minmax(0,1fr)!important}}
:where(.lhp-grid){display:grid;gap:calc(24px * var(--lhp-density));grid-template-columns:repeat(var(--lhp-cols,3),minmax(0,1fr))}
@container lhp (max-width:1023px){:where(.lhp-grid){grid-template-columns:repeat(min(var(--lhp-cols,3),2),minmax(0,1fr))}}
@container lhp (max-width:639px){:where(.lhp-grid){grid-template-columns:minmax(0,1fr)}}
:where(.lhp-row){display:flex;justify-content:safe center;gap:calc(20px * var(--lhp-density));overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:8px;scrollbar-width:thin}
:where(.lhp-row > *){flex:0 0 min(320px,85%);scroll-snap-align:start}
:where(.lhp-card){background:var(--lhp-background);color:var(--lhp-text);border-radius:var(--lhp-radius);overflow:hidden;display:flex;flex-direction:column;min-width:0}
:where(.lhp-card[data-card=shadow]){box-shadow:0 1px 2px rgba(15,23,42,.05),0 8px 24px -12px rgba(15,23,42,.18)}
:where(.lhp-card[data-card=border]){border:1px solid var(--lhp-border)}
:where(.lhp-card[data-card=flat]){background:var(--lhp-surface)}
:where(.lhp-card[data-card=minimal]){background:transparent;color:inherit}
:where(a.lhp-card){text-decoration:none;transition:transform .2s ease,box-shadow .2s}
:where(a.lhp-card):hover{transform:translateY(-3px)}
:where(.lhp-card-body){padding:calc(20px * var(--lhp-density));display:flex;flex-direction:column;gap:.4rem;flex:1}
:where(.lhp-card[data-card=minimal] .lhp-card-body){padding:14px 2px 0}
:where(.lhp-card-title){font-family:var(--lhp-font-heading);font-weight:650;font-size:1.0625rem;line-height:1.3;margin:0}
:where(.lhp-card-text){color:var(--lhp-muted);font-size:.9375rem;line-height:1.55}
:where(.lhp-card[data-card=minimal] .lhp-card-text){color:inherit;opacity:.7}
:where(.lhp-clamp2){display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
:where(.lhp-thumb){aspect-ratio:16/9;width:100%;object-fit:cover;display:block;background:var(--lhp-surface)}
:where(.lhp-thumb-ph){aspect-ratio:16/9;width:100%;display:flex;align-items:center;justify-content:center;font-family:var(--lhp-font-heading);font-weight:700;font-size:2.25rem;color:color-mix(in srgb,var(--lhp-primary) 70%,var(--lhp-text));background:radial-gradient(circle at 20% 15%,color-mix(in srgb,var(--lhp-accent) 16%,transparent),transparent 55%),linear-gradient(135deg,color-mix(in srgb,var(--lhp-primary) 9%,var(--lhp-surface)),color-mix(in srgb,var(--lhp-primary) 18%,var(--lhp-surface)))}
:where(.lhp-more){display:inline-flex;align-items:center;gap:.35rem;color:var(--lhp-primary);font-weight:600;font-size:.875rem;margin-top:auto;padding-top:.5rem}
:where(.lhp-icon-tile){display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:calc(var(--lhp-radius) * .75);background:color-mix(in srgb,var(--lhp-primary) 12%,transparent);color:var(--lhp-primary);flex:none}
:where(.lhp-emoji){font-size:2rem;line-height:1}
:where(.lhp-quote){font-size:1.0625rem;line-height:1.6}
:where(.lhp-stars){display:flex;gap:2px;color:#f59e0b}
:where(.lhp-avatar){width:44px;height:44px;border-radius:999px;object-fit:cover;flex:none;background:var(--lhp-surface);display:inline-flex;align-items:center;justify-content:center;font-weight:700;color:var(--lhp-muted)}
:where(.lhp-faq){display:flex;flex-direction:column;gap:12px}
:where(.lhp-faq details){background:var(--lhp-background);color:var(--lhp-text);border-radius:var(--lhp-radius);border:1px solid var(--lhp-border)}
:where(.lhp-faq summary){display:flex;align-items:center;justify-content:space-between;gap:1rem;cursor:pointer;list-style:none;padding:18px 20px;font-weight:600}
:where(.lhp-faq summary)::-webkit-details-marker{display:none}
:where(.lhp-faq details[open] .lhp-caret){transform:rotate(180deg)}
:where(.lhp-faq .lhp-caret){transition:transform .2s;flex:none;opacity:.6}
:where(.lhp-faq .lhp-answer){padding:0 20px 18px;color:var(--lhp-muted);white-space:pre-line}
:where(.lhp-stats){display:flex;flex-wrap:wrap;justify-content:center;gap:calc(40px * var(--lhp-density)) calc(64px * var(--lhp-density))}
:where(.lhp-stat){display:flex;flex-direction:column;align-items:center;text-align:center;min-width:120px}
:where(.lhp-stat-value){font-family:var(--lhp-font-heading);font-weight:var(--lhp-heading-weight);font-size:clamp(2rem,4cqi,3rem);letter-spacing:-.03em;line-height:1.1}
:where(.lhp-stat-label){opacity:.7;font-size:.9375rem;margin-top:.25rem}
:where(.lhp-logos){display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:28px 56px}
:where(.lhp-logos img){display:block;object-fit:contain;max-width:180px;transition:filter .2s,opacity .2s}
:where(.lhp-logos[data-gray=true] img){filter:grayscale(1);opacity:.7}
:where(.lhp-logos[data-gray=true] img):hover{filter:none;opacity:1}
:where(.lhp-steps){display:grid;gap:28px;grid-template-columns:repeat(var(--lhp-cols,3),minmax(0,1fr));counter-reset:step}
@container lhp (max-width:820px){:where(.lhp-steps){grid-template-columns:minmax(0,1fr)}}
:where(.lhp-steps[data-layout=vertical]){grid-template-columns:minmax(0,1fr);max-width:720px}
:where(.lhp-step){display:flex;flex-direction:column;gap:.5rem}
:where(.lhp-steps[data-layout=vertical] .lhp-step){flex-direction:row;gap:1.1rem}
:where(.lhp-step-n){width:40px;height:40px;border-radius:999px;background:var(--lhp-primary);color:var(--lhp-on-primary);display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex:none}
:where(.lhp-countdown){display:flex;justify-content:center;gap:12px;flex-wrap:wrap}
:where(.lhp-countdown > div){min-width:84px;padding:16px 10px;border-radius:var(--lhp-radius);background:var(--lhp-background);color:var(--lhp-text);text-align:center;box-shadow:0 1px 2px rgba(15,23,42,.06)}
:where(.lhp-countdown b){display:block;font-size:2.25rem;font-variant-numeric:tabular-nums;font-family:var(--lhp-font-heading);line-height:1.1}
:where(.lhp-countdown span){font-size:.75rem;color:var(--lhp-muted)}
@container lhp (max-width:479px){:where(.lhp-countdown){gap:8px}:where(.lhp-countdown > div){min-width:0;flex:1 1 0;padding:12px 4px}:where(.lhp-countdown b){font-size:1.6rem}}
:where(.lhp-input){height:48px;width:100%;min-width:0;border-radius:var(--lhp-radius-btn);border:1px solid var(--lhp-border);background:var(--lhp-background);color:var(--lhp-text);padding:0 14px;font:inherit;font-size:.9375rem}
:where(textarea.lhp-input){height:auto;min-height:120px;padding:12px 14px;border-radius:calc(var(--lhp-radius) * .6);resize:vertical}
:where(.lhp-input):focus{outline:2px solid color-mix(in srgb,var(--lhp-primary) 45%,transparent);outline-offset:1px}
:where(.lhp-field){display:flex;flex-direction:column;gap:6px;font-size:.875rem;font-weight:500;text-align:start}
:where(.lhp-section) > :where(.lhp-nav,.lhp-footer){max-width:var(--lhp-width)}
/* Elements dropped straight into a section (no content container) stay centered. */
:where(.lhp-section) > :where(:not(.lhp-container,.lhp-cols,.lhp-bgvideo)){margin-inline:auto}
:where(.lhp-nav){display:flex;align-items:center;justify-content:space-between;gap:24px;width:100%}
:where(.lhp-nav[data-variant=centered]){flex-direction:column;gap:14px}
:where(.lhp-nav-links){display:flex;align-items:center;gap:28px;flex-wrap:wrap}
:where(.lhp-nav-links a:not(.lhp-btn)){color:inherit;text-decoration:none;font-weight:500;font-size:.9375rem;opacity:.85}
:where(.lhp-nav-links a:not(.lhp-btn)):hover{opacity:1}
:where(.lhp-nav-logo){display:flex;align-items:center;gap:10px;font-family:var(--lhp-font-heading);font-weight:700;font-size:1.125rem;color:inherit;text-decoration:none}
:where(.lhp-nav-logo img){height:36px;width:auto;max-width:200px;object-fit:contain;display:block}
:where(.lhp-nav-toggle){display:none}
@container lhp (max-width:820px){:where(.lhp-nav .lhp-nav-links){display:none}:where(.lhp-nav .lhp-nav-toggle){display:inline-flex}:where(.lhp-nav[data-open=true]){flex-wrap:wrap}:where(.lhp-nav[data-open=true] .lhp-nav-links){display:flex;flex-direction:column;align-items:flex-start;width:100%;order:3;gap:14px;padding-top:8px}}
:where(.lhp-footer){display:flex;flex-direction:column;gap:32px;font-size:.9375rem}
:where(.lhp-footer-top){display:flex;flex-wrap:wrap;justify-content:space-between;gap:32px}
:where(.lhp-footer-col){display:flex;flex-direction:column;gap:10px;min-width:140px}
:where(.lhp-footer-col b){font-weight:600}
:where(.lhp-footer a){color:inherit;opacity:.75;text-decoration:none}
:where(.lhp-footer a):hover{opacity:1}
:where(.lhp-footer-bottom){display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;padding-top:24px;border-top:1px solid var(--lhp-border);opacity:.75;font-size:.875rem}
:where(.lhp-social){display:flex;gap:14px}
:where(.lhp-prose){font-size:1.0625rem;line-height:1.7;overflow-wrap:anywhere}
:where(.lhp-prose) :where(h1,h2,h3){font-family:var(--lhp-font-heading);font-weight:var(--lhp-heading-weight);line-height:1.2;margin:1.4em 0 .5em}
:where(.lhp-prose) :where(h1){font-size:2rem}:where(.lhp-prose) :where(h2){font-size:1.5rem}:where(.lhp-prose) :where(h3){font-size:1.2rem}
:where(.lhp-prose) :where(p,ul,ol,blockquote){margin:.75em 0}
:where(.lhp-prose) :where(ul){list-style:disc;padding-inline-start:1.4em}:where(.lhp-prose) :where(ol){list-style:decimal;padding-inline-start:1.4em}
:where(.lhp-prose) :where(a){color:var(--lhp-primary);text-decoration:underline;text-underline-offset:2px}
:where(.lhp-prose) :where(blockquote){border-inline-start:3px solid var(--lhp-border);padding-inline-start:1em;opacity:.85}
:where(.lhp-prose) :where(code){background:rgba(127,127,127,.15);padding:.1em .35em;border-radius:4px;font-size:.9em}
:where(.lhp-prose) > :first-child{margin-top:0}:where(.lhp-prose) > :last-child{margin-bottom:0}
:where(.lhp-frame){display:block;width:100%;border:0;background:transparent}
:where(.lhp-video){position:relative;width:100%;aspect-ratio:16/9;background:#000;overflow:hidden}
:where(.lhp-video iframe,.lhp-video video){position:absolute;inset:0;width:100%;height:100%;border:0}
.lhp-root[data-mode=canvas] a{cursor:default}
.lhp-root[data-mode=canvas] iframe{pointer-events:none}
.lhp-root [contenteditable=true]{outline:2px solid #3b82f6;outline-offset:3px;cursor:text;border-radius:2px}
[data-anim]{animation-fill-mode:both;animation-timing-function:cubic-bezier(.2,.7,.2,1);animation-play-state:paused}
[data-anim].lhp-in{animation-play-state:running}
[data-anim=fade]{animation-name:lhp-fade}
[data-anim=slide-up]{animation-name:lhp-slide-up}
[data-anim=slide-in]{animation-name:lhp-slide-in}
[data-anim=zoom]{animation-name:lhp-zoom}
@keyframes lhp-fade{from{opacity:0}to{opacity:1}}
@keyframes lhp-slide-up{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
@keyframes lhp-slide-in{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}
@keyframes lhp-zoom{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){[data-anim]{animation:none!important}:where(.lhp-btn):hover,:where(a.lhp-card):hover{transform:none}}
`
