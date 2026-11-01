/* theme.js — CET-6 词汇刷题系统模块（从 cet6_quiz.html 拆分） */
// ============ THEME TOGGLE (白天黑夜切换按钮 4.0) ============
// 组件开源：https://github.com/Xiumuzaidiao/Day-night-toggle-button （ISC License, Copyright(c)2024 Xiumuzaidiao）
var THEME_KEY = 'cet6_theme';
function applyTheme(t) {
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  var isDark = t === 'dark' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (window.Chart) {
    try { Chart.defaults.color = isDark ? '#94a3b8' : '#737373'; } catch(e) {}
  }
  // 注意：这里不再同步重绘图表。统计页 5 张图（含热力图画布）销毁重建要几百
  // 毫秒，若放在 View Transitions 的更新回调里，会把“新主题快照”的生成拖住，
  // 动画首帧因此顿住——这就是切换生硬卡顿的根源。图表重绘由 switchTheme
  // 推迟到扩散动画播放期间执行（VT 动画由合成器驱动，不受主线程重绘影响）。
}
function rerenderChartsAfterTheme() {
  // 主题切换后的图表重绘：临时关闭 Chart.js 入场动画，避免柱状图重新生长、
  // 雷达图旋转带来的二次视觉抖动，重绘完成后恢复原设置。
  var hadAnim;
  var animSaved = false;
  if (window.Chart) {
    try { hadAnim = Chart.defaults.animation; Chart.defaults.animation = false; animSaved = true; } catch(e) {}
  }
  try { if (typeof renderAllCharts === 'function') renderAllCharts(); } catch(e) {}
  if (animSaved) {
    try { Chart.defaults.animation = hadAnim; } catch(e) {}
  }
}
function switchTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch(e) {}
  if (document.startViewTransition) {
    // 圆形扩散：以按钮为圆心，新主题成片展开（View Transitions API）
    var btn = document.getElementById('themeBtn');
    var rect = btn ? btn.getBoundingClientRect() : null;
    var x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    var y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    var r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    var root = document.documentElement;
    root.style.setProperty('--vt-x', x + 'px');
    root.style.setProperty('--vt-y', y + 'px');
    // 余量：圆最终半径比最远视口角再大 15% + 30px，保证左右下角在动画中段即被覆盖，
    // 不会在动画最后一帧才“卡顿一下”切换到新主题（配合上面较平缓的缓动）
    root.style.setProperty('--vt-r', Math.round(r * 1.15 + 30) + 'px');
    var vt = document.startViewTransition(function() { applyTheme(t); });
    // 快照生成后立即在真实 DOM 上重绘图表：扩散动画由合成器驱动、展示的是
    // 两份快照，主线程重绘不影响其流畅度；动画结束时图表已就位为新配色。
    var rerender = function() { rerenderChartsAfterTheme(); };
    if (vt && vt.updateCallbackDone) vt.updateCallbackDone.then(rerender, rerender);
    else rerender();
  } else {
    // 回退：短暂的全局颜色过渡代替无动画瞬切
    var root = document.documentElement;
    root.classList.add('theme-fade');
    applyTheme(t);
    setTimeout(function() {
      root.classList.remove('theme-fade');
      rerenderChartsAfterTheme();
    }, 320);
  }
}
// —— 白天黑夜切换按钮 4.0 组件（原文件原文）——
(() => {
  const func = (root, initTheme, changeTheme) => {
    const $ = (s) => {
      let dom = root.querySelectorAll(s);
      return dom.length == 1 ? dom[0] : dom;
    };
    let mainButton = $(".main-button");
    let daytimeBackground = $(".daytime-background");
    let cloud = $(".cloud");
    let cloudList = $(".cloud-son");
    let cloudLight = $(".cloud-light");
    let components = $(".components");
    let moon = $(".moon");
    let stars = $(".stars");
    let star = $(".star");
    let isMoved = false;
    let isClicked = false;
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      toggleThemeBasedOnSystem();
    });
    const toggleThemeBasedOnSystem = () => {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        if (!isMoved) {
          components.onclick();
        }
      } else {
        if (isMoved) {
          components.onclick();
        }
      }
    };
    components.onclick = () => {
      if (isMoved) {
        mainButton.style.transform = "translateX(0)";
        mainButton.style.backgroundColor = "rgba(255, 195, 35,1)";

        mainButton.style.boxShadow =
          "3em 3em 5em rgba(0, 0, 0, 0.5), inset  -3em -5em 3em -3em rgba(0, 0, 0, 0.5), inset  4em 5em 2em -2em rgba(255, 230, 80,1)";

        daytimeBackground[0].style.transform = "translateX(0)";
        daytimeBackground[1].style.transform = "translateX(0)";
        daytimeBackground[2].style.transform = "translateX(0)";
        cloud.style.transform = "translateY(10em)";
        cloudLight.style.transform = "translateY(10em)";
        components.style.backgroundColor = "rgba(70, 133, 192,1)";

        moon[0].style.opacity = "0";
        moon[1].style.opacity = "0";
        moon[2].style.opacity = "0";

        stars.style.transform = "translateY(-125em)";
        stars.style.opacity = "0";

        changeTheme("light");
      } else {
        mainButton.style.transform = "translateX(110em)";
        mainButton.style.backgroundColor = "rgba(195, 200,210,1)";

        mainButton.style.boxShadow =
          "3em 3em 5em rgba(0, 0, 0, 0.5), inset  -3em -5em 3em -3em rgba(0, 0, 0, 0.5), inset  4em 5em 2em -2em rgba(255, 255, 210,1)";

        daytimeBackground[0].style.transform = "translateX(110em)";
        daytimeBackground[1].style.transform = "translateX(80em)";
        daytimeBackground[2].style.transform = "translateX(50em)";
        cloud.style.transform = "translateY(80em)";
        cloudLight.style.transform = "translateY(80em)";
        components.style.backgroundColor = "rgba(25,30,50,1)";

        moon[0].style.opacity = "1";
        moon[1].style.opacity = "1";
        moon[2].style.opacity = "1";

        stars.style.transform = "translateY(-62.5em)";
        stars.style.opacity = "1";

        changeTheme("dark");
      }

      isClicked = true;

      setTimeout(function () {
        isClicked = false;
      }, 500);
      isMoved = !isMoved;
    };

    mainButton.addEventListener("mousemove", function () {
      if (isClicked) return;

      if (isMoved) {
        mainButton.style.transform = "translateX(100em)";
        daytimeBackground[0].style.transform = "translateX(100em)";
        daytimeBackground[1].style.transform = "translateX(73em)";
        daytimeBackground[2].style.transform = "translateX(46em)";

        star[0].style.top = "10em";
        star[0].style.left = "36em";
        star[1].style.top = "40em";
        star[1].style.left = "87em";
        star[2].style.top = "26em";
        star[2].style.left = "16em";
        star[3].style.top = "38em";
        star[3].style.left = "63em";
        star[4].style.top = "20.5em";
        star[4].style.left = "72em";
        star[5].style.top = "51.5em";
        star[5].style.left = "35em";
      } else {
        mainButton.style.transform = "translateX(10em)";
        daytimeBackground[0].style.transform = "translateX(10em)";
        daytimeBackground[1].style.transform = "translateX(7em)";
        daytimeBackground[2].style.transform = "translateX(4em)";

        cloudList[0].style.right = "-24em";
        cloudList[0].style.bottom = "10em";
        cloudList[1].style.right = "-12em";
        cloudList[1].style.bottom = "-27em";
        cloudList[2].style.right = "17em";
        cloudList[2].style.bottom = "-43em";
        cloudList[3].style.right = "46em";
        cloudList[3].style.bottom = "-39em";
        cloudList[4].style.right = "70em";
        cloudList[4].style.bottom = "-65em";
        cloudList[5].style.right = "109em";
        cloudList[5].style.bottom = "-54em";
        cloudList[6].style.right = "-23em";
        cloudList[6].style.bottom = "10em";
        cloudList[7].style.right = "-11em";
        cloudList[7].style.bottom = "-26em";
        cloudList[8].style.right = "18em";
        cloudList[8].style.bottom = "-42em";
        cloudList[9].style.right = "47em";
        cloudList[9].style.bottom = "-38em";
        cloudList[10].style.right = "74em";
        cloudList[10].style.bottom = "-64em";
        cloudList[11].style.right = "110em";
        cloudList[11].style.bottom = "-55em";
      }
    });

    mainButton.addEventListener("mouseout", function () {
      if (isClicked) {
        return;
      }
      if (isMoved) {
        mainButton.style.transform = "translateX(110em)";
        daytimeBackground[0].style.transform = "translateX(110em)";
        daytimeBackground[1].style.transform = "translateX(80em)";
        daytimeBackground[2].style.transform = "translateX(50em)";

        star[0].style.top = "11em";
        star[0].style.left = "39em";
        star[1].style.top = "39em";
        star[1].style.left = "91em";
        star[2].style.top = "26em";
        star[2].style.left = "19em";
        star[3].style.top = "37em";
        star[3].style.left = "66em";
        star[4].style.top = "21em";
        star[4].style.left = "75em";
        star[5].style.top = "51em";
        star[5].style.left = "38em";
      } else {
        mainButton.style.transform = "translateX(0em)";
        daytimeBackground[0].style.transform = "translateX(0em)";
        daytimeBackground[1].style.transform = "translateX(0em)";
        daytimeBackground[2].style.transform = "translateX(0em)";

        cloudList[0].style.right = "-20em";
        cloudList[0].style.bottom = "10em";
        cloudList[1].style.right = "-10em";
        cloudList[1].style.bottom = "-25em";
        cloudList[2].style.right = "20em";
        cloudList[2].style.bottom = "-40em";
        cloudList[3].style.right = "50em";
        cloudList[3].style.bottom = "-35em";
        cloudList[4].style.right = "75em";
        cloudList[4].style.bottom = "-60em";
        cloudList[5].style.right = "110em";
        cloudList[5].style.bottom = "-50em";
        cloudList[6].style.right = "-20em";
        cloudList[6].style.bottom = "10em";
        cloudList[7].style.right = "-10em";
        cloudList[7].style.bottom = "-25em";
        cloudList[8].style.right = "20em";
        cloudList[8].style.bottom = "-40em";
        cloudList[9].style.right = "50em";
        cloudList[9].style.bottom = "-35em";
        cloudList[10].style.right = "75em";
        cloudList[10].style.bottom = "-60em";
        cloudList[11].style.right = "110em";
        cloudList[11].style.bottom = "-50em";
      }
    });

    const getRandomDirection = () => {
      const directions = ["2em", "-2em"];
      return directions[Math.floor(Math.random() * directions.length)];
    };

    const moveElementRandomly = (element) => {
      const randomDirectionX = getRandomDirection();
      const randomDirectionY = getRandomDirection();
      element.style.transform = `translate(${randomDirectionX}, ${randomDirectionY})`;
    };

    const cloudSons = root.querySelectorAll(".cloud-son");
    setInterval(() => {
      cloudSons.forEach(moveElementRandomly);
    }, 1000);

    if (initTheme === "dark") {
      components.onclick();
    }
  };

  class ThemeButton extends HTMLElement {
    constructor() {
      super();
    }
    connectedCallback() {
      const initTheme = this.getAttribute("value") || "light";
      const size = +this.getAttribute("size") || 3;
      const shadow = this.attachShadow({ mode: "closed" });
      const container = document.createElement("div");
      container.setAttribute("class", "container");
      container.setAttribute("style", `font-size: ${(size / 3).toFixed(2)}px`);
      container.innerHTML =
        '<div class="components"><div class="main-button"><div class="moon"></div><div class="moon"></div><div class="moon"></div></div><div class="daytime-background"></div><div class="daytime-background"></div><div class="daytime-background"></div><div class="cloud"><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div></div><div class="cloud-light"><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div></div><div class="stars"><div class="star big"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star big"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star medium"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star medium"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star small"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star small"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div></div></div>';
      const style = document.createElement("style");
      style.textContent =
        "* { margin: 0; padding: 0; transition: 0.7s; -webkit-tap-highlight-color:rgba(0,0,0,0); } .container { position: absolute;top: 50%;left: 50%;margin-top: -35em;margin-left: -90em;width: 180em; height: 70em; display: inline-block; vertical-align: bottom; transform: translate3d(0, 0, 0); } .components{ position:fixed; width: 180em; height: 70em; background-color: rgba(70, 133, 192,1); border-radius: 100em; box-shadow: inset 0 0 5em 3em rgba(0, 0, 0, 0.5); overflow: hidden; transition: 0.7s; transition-timing-function: cubic-bezier( 0,0.5, 1,1); cursor: pointer; } .main-button{ margin: 7.5em 0 0 7.5em; width: 55em; height:55em; background-color: rgba(255, 195, 35,1); border-radius: 50%; box-shadow:3em 3em 5em rgba(0, 0, 0, 0.5), inset -3em -5em 3em -3em rgba(0, 0, 0, 0.5), inset 4em 5em 2em -2em rgba(255, 230, 80,1); transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .moon{ position: absolute; background-color: rgba(150, 160, 180, 1); box-shadow:inset 0em 0em 1em 1em rgba(0, 0, 0, 0.3) ; border-radius: 50%; transition: 0.5s; opacity: 0; } .moon:nth-child(1){ top: 7.5em; left: 25em; width: 12.5em; height: 12.5em; } .moon:nth-child(2){ top: 20em; left: 7.5em; width: 20em; height: 20em; } .moon:nth-child(3){ top: 32.5em; left: 32.5em; width: 12.5em; height: 12.5em; } .daytime-background { position: absolute; border-radius: 50%; transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .daytime-background:nth-child(2){ top: -20em; left: -20em; width: 110em; height:110em; background-color: rgba(255, 255, 255,0.2); z-index: -2; } .daytime-background:nth-child(3){ top: -32.5em; left: -17.5em; width: 135em; height:135em; background-color: rgba(255, 255, 255,0.1); z-index: -3; } .daytime-background:nth-child(4){ top: -45em; left: -15em; width: 160em; height:160em; background-color: rgba(255, 255, 255,0.05); z-index: -4; } .cloud,.cloud-light{ transform: translateY(10em); transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .cloud-son{ position: absolute; background-color: #fff; border-radius: 50%; z-index: -1; transition: transform 6s,right 1s,bottom 1s; } .cloud-son:nth-child(6n+1){ right: -20em; bottom: 10em; width: 50em; height: 50em; } .cloud-son:nth-child(6n+2) { right: -10em; bottom: -25em; width: 60em; height: 60em; } .cloud-son:nth-child(6n+3) { right: 20em; bottom: -40em; width: 60em; height: 60em; } .cloud-son:nth-child(6n+4) { right: 50em; bottom: -35em; width: 60em; height: 60em; } .cloud-son:nth-child(6n+5) { right: 75em; bottom: -60em; width: 75em; height: 75em; } .cloud-son:nth-child(6n+6) { right: 110em; bottom: -50em; width: 60em; height: 60em; } .cloud{ z-index: -2; } .cloud-light{ position: absolute; right: 0em; bottom: 25em; opacity: 0.5; z-index: -3; /*transform: rotate(-5deg);*/ } .stars{ transform: translateY(-125em); z-index: -2; transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .big { --size: 7.5em; } .medium { --size: 5em; } .small { --size: 3em; } .star { position: absolute; width: calc(2*var(--size)); height: calc(2*var(--size)); } .star:nth-child(1){ top: 11em; left: 39em; animation-name: star; animation-duration: 3.5s; } .star:nth-child(2){ top: 39em; left: 91em; animation-name: star; animation-duration: 4.1s; } .star:nth-child(3){ top: 26em; left: 19em; animation-name: star; animation-duration: 4.9s; } .star:nth-child(4){ top: 37em; left: 66em; animation-name: star; animation-duration: 5.3s; } .star:nth-child(5){ top: 21em; left: 75em; animation-name: star; animation-duration: 3s; } .star:nth-child(6){ top: 51em; left: 38em; animation-name: star; animation-duration: 2.2s; } @keyframes star { 0%,20%{ transform: scale(0); } 20%,100% { transform: scale(1); } } .star-son{ float: left; } .star-son:nth-child(1) { --pos: left 0; } .star-son:nth-child(2) { --pos: right 0; } .star-son:nth-child(3) { --pos: 0 bottom; } .star-son:nth-child(4) { --pos: right bottom; } .star-son { width: var(--size); height: var(--size); background-image: radial-gradient(circle var(--size) at var(--pos), transparent var(--size), #fff); } .star{ transform: scale(1); transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); transition: 1s; animation-iteration-count:infinite; animation-direction: alternate; animation-timing-function: linear; } .twinkle { transform: scale(0); }";
      const changeTheme = (detail) => {
        this.dispatchEvent(new CustomEvent("change", { detail }));
      };
      func(container, initTheme, changeTheme);
      shadow.appendChild(style);
      shadow.appendChild(container);
    }
  }

  customElements.define("theme-button", ThemeButton);
})();
// —— 组件创建与主题联动 ——
(function() {
  var val = 'light';
  try {
    var saved = localStorage.getItem(THEME_KEY) || '';
    if (saved === 'dark') val = 'dark';
    else if (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) val = 'dark';
  } catch(e) {}
  // 尺寸：size=3 → 180×70（组件内 1em=1px）。按钮高度对齐 h1（1.6em×1.3 行高 ≈ 33px）：
  // 桌面端 s=1.5 → 90×35；小屏 h1 缩到 1.15em（≈24px），按钮同步缩到 60×23
  var s = 1.5;
  if (window.innerWidth < 480) s = 1.0;
  var tb = document.createElement('theme-button');
  tb.id = 'themeBtn';
  // Keep a readable light-DOM label for tests, screen readers, and browsers that cannot inspect closed shadow DOM.
  tb.textContent = val === 'dark' ? '☀️' : '🌙';
  tb.setAttribute('value', val); // 必须在组件连接(connectedCallback)之前写入，保证初始状态与已保存主题一致
  tb.setAttribute('size', String(s));
  tb.setAttribute('title', '切换白天/黑夜');
  tb.setAttribute('aria-label', '切换白天/黑夜');
  tb.style.width = Math.round(180 * s / 3) + 'px';
  tb.style.height = Math.round(70 * s / 3) + 'px';
  var slot = document.getElementById('themeSlot');
  // 宿主在 shadow DOM 内无流内内容，min-content 为 0，会让 1fr 轨道缩到比按钮还窄；
  // 给槽位（网格项）设置与胶囊等宽的最小宽度，保证按钮列始终容得下按钮、不会向左压到标题
  if (slot) slot.style.minWidth = Math.round(180 * s / 3) + 'px';
  (slot || document.body).appendChild(tb);
})();
(function() {
  var b = document.getElementById('themeBtn');
  if (b) b.addEventListener('change', function(e) {
    var next = e.detail === 'dark' ? 'dark' : 'light';
    b.textContent = next === 'dark' ? '☀️' : '🌙';
    switchTheme(next);
  });
  var saved = '';
  try { saved = localStorage.getItem(THEME_KEY) || ''; } catch(e) {}
  applyTheme(saved);
})();
;// ============ MANUAL CONFUSABLE GROUPS ============
var CONFUSABLE_GROUPS = [
  ['adapt','adept','adopt'],
  ['assure','ensure','insure'],
  ['affect','effect','effort'],
  ['aboard','abroad','broad'],
  ['altitude','attitude','latitude','longitude','multitude'],
  ['award','reward','ward','wardrobe'],
  ['compliment','complement','supplement','implement'],
  ['conscious','conscience','conscientious','consciousness'],
  ['consider','considerate','considerable','considering'],
  ['crash','crush','clash','crack'],
  ['dairy','diary','daily'],
  ['dedicate','delicate','delegate','deliberate'],
  ['desert','dessert','deserve','dissert'],
  ['distinct','distinguish','extinct','instinct'],
  ['economic','economical','economy','economics'],
  ['emerge','emergency','immerge','merge'],
  ['exceed','excess','excel','except'],
  ['expand','expend','extend','extent'],
  ['explore','exploit','explode','export'],
  ['extend','extent','extensive','intensive'],
  ['incident','accident','incidence','coincidence'],
  ['industrial','industrious','industry','industrialize'],
  ['inform','informal','information','reform','perform'],
  ['inspire','inspiration','aspiration','expire'],
  ['intense','intensive','intention','intentional'],
  ['interpret','interrupt','intervene','interval'],
  ['latter','later','late','lateral'],
  ['principle','principal','principally'],
  ['proceed','precede','procedure','process'],
  ['prospect','perspective','prosperity','prosperous'],
  ['receive','receipt','reception','deceive','conceive'],
  ['require','acquire','enquire','inquire'],
  ['reserve','preserve','conserve','deserve','observe'],
  ['resolve','revolve','evolve','involve','dissolve'],
  ['respect','inspect','aspect','suspect','prospect'],
  ['restrict','restrain','constrain','refrain'],
  ['reveal','revival','revenue','revenge'],
  ['rise','raise','arise','arouse','rural'],
  ['sensitive','sensible','sentimental','sensational'],
  ['simulate','stimulate','assimilate','simultaneous'],
  ['succeed','success','successor','succession','successive'],
  ['sustain','contain','maintain','retain','obtain','attain'],
  ['transfer','transform','transmit','transplant','transport'],
  ['treat','retreat','treaty','treatment'],
  ['vary','various','variety','variable','variation'],
  ['wander','wonder','wound','warn'],
  ['worth','worthy','worthwhile','worship'],
  ['abandon','abundant','abound'],
  ['convention','convenient','convenience','conversation'],
  ['defect','defend','defendant','defense'],
  ['deny','defy','denial'],
  ['despite','despise','dispute','dispose'],
  ['dominate','dominant','domain','domestic'],
  ['emotion','motion','motive','motivate','promote'],
  ['ensure','endure','endurance','duration'],
  ['expose','impose','compose','suppose','oppose','dispose'],
  ['glimpse','glory','glare','gleam','glitter'],
  ['image','imagine','imaginary','imaginative','imagination'],
  ['insist','persist','consist','resist','assist'],
  ['luxury','luxurious','luxuriant'],
  ['magnificent','magnify','magnitude','magnificence'],
  ['offend','defend','offensive','defensive'],
  ['produce','product','production','productive','productivity'],
  ['promise','promising','compromise','premise'],
  ['refer','infer','prefer','differ','offer','suffer','transfer'],
  ['rely','relay','reliable','reliance','religion'],
  ['sign','signal','signature','significant','design','assign'],
  ['strain','restrain','restraint','constrain','constraint'],
  ['substance','substantial','substitute','substitution'],
  ['survey','convey','survive','survival'],
  ['tend','tendency','tender','tense','intense','extend','pretend','attend','intend'],
  ['trace','track','trail','trait','tram','trap','trial'],
  ['venture','adventure','event','eventual'],
];

function getConfusableGroupMembers(word) {
  var lower = word.toLowerCase();
  var members = [];
  for (var g = 0; g < CONFUSABLE_GROUPS.length; g++) {
    var group = CONFUSABLE_GROUPS[g];
    for (var i = 0; i < group.length; i++) {
      if (group[i] === lower) {
        for (var j = 0; j < group.length; j++) {
          if (j !== i) members.push(group[j]);
        }
        return members;
      }
    }
  }
  return members;
}
