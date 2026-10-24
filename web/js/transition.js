// AK-1835-1903 vitrin — canvas geçiş efekti (yalnız süs, aria-hidden).
// Gerçek içerik HTML olarak durur; burada çizilen hiçbir şey veri taşımaz.
// Dışa açık sözleşme (main.js bunlara bağlı, DEĞİŞMEDİ):
//   window.AKTransition.create(canvas) -> örnek
//   window.AKTransition.supportsFull() -> boolean (statik)
//   örnek.play({duration, reverse, onDone})

(function () {
  "use strict";

  var COLS = 8;
  var ROWS = 4;
  var CELLS = COLS * ROWS; // 32
  var LOGICAL_W = 640;
  var LOGICAL_H = 288;
  var CELL_W = LOGICAL_W / COLS; // 80
  var CELL_H = LOGICAL_H / ROWS; // 72
  var MIN_SCALE = 0.22;

  var BLOCK_COLORS = ["#6b4e37", "#5d4330", "#775840"];
  var LINE_COLOR = "#2c2218";
  var BG_COLOR = "#1b2418";
  var GEAR_COLOR = "#3f5233";
  var CODE_COLOR = "#d7c28a";

  // --- Palet C'nin aynı renklerinden açık/koyu türevler (yeni renk ailesi YOK). ---
  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function shade(hex, amt) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var target = amt >= 0 ? 255 : 0;
    var t = Math.abs(amt);
    r = clamp255(Math.round(r + (target - r) * t));
    g = clamp255(Math.round(g + (target - g) * t));
    b = clamp255(Math.round(b + (target - b) * t));
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function shadeAlpha(hex, amt, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var target = amt >= 0 ? 255 : 0;
    var t = Math.abs(amt);
    r = clamp255(Math.round(r + (target - r) * t));
    g = clamp255(Math.round(g + (target - g) * t));
    b = clamp255(Math.round(b + (target - b) * t));
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  var GEAR_COLOR_LIGHT = shade(GEAR_COLOR, 0.35);
  var RAIL_COLOR_DARK = shade(GEAR_COLOR, -0.25);
  var RAIL_COLOR_LIGHT = shade(GEAR_COLOR, 0.4);
  var CODE_COLOR_BRIGHT = shade(CODE_COLOR, 0.25);
  var CODE_COLOR_DIM = shade(CODE_COLOR, -0.35);
  var BLOCK_SHADOW_COLOR = shadeAlpha(BG_COLOR, -0.6, 0.35);
  var BLOCK_HIGHLIGHTS = [];
  for (var bi = 0; bi < BLOCK_COLORS.length; bi++) {
    BLOCK_HIGHLIGHTS.push(shade(BLOCK_COLORS[bi], 0.3));
  }

  // Hedef hücre d için kaynak hücre: S[d] = (d*5+11) % 32. (dönüşte tersi)
  var FORWARD_SOURCE = [];
  for (var d = 0; d < CELLS; d++) {
    FORWARD_SOURCE[d] = (d * 5 + 11) % CELLS;
  }
  var REVERSE_SOURCE = [];
  for (var s = 0; s < CELLS; s++) {
    REVERSE_SOURCE[FORWARD_SOURCE[s]] = s;
  }

  function cellCenter(index) {
    var col = index % COLS;
    var row = Math.floor(index / COLS);
    return {
      x: col * CELL_W + CELL_W / 2,
      y: row * CELL_H + CELL_H / 2
    };
  }

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  // --- Üretilmiş onaltılık/şifre akışı — gerçek veri YOK. ---
  // KÖK NEDEN DÜZELTMESİ (WEB-V1-ARKAPLAN-1): önceki LCG `x * çarpan` ile
  // Number.MAX_SAFE_INTEGER'ı aşan bir çarpım üretiyordu (kayan nokta
  // hassasiyet kaybı); ayrıca çıkışı x%16 (EN ALT nibble) alıyordu, klasik
  // LCG kusuru: alt bitlerin periyodu çok kısadır (burada 16). Düzeltme:
  // Math.imul ile DOĞRU 32-bit tam sayı çarpımı + ÜST nibble (bit 24-27).
  function lcgNext(x) {
    return (Math.imul(x, 1103515245) + 12345) >>> 0;
  }

  var STREAM_CHARS = "0123456789abcdef";

  function makeHexStream(seed, length) {
    length = length || 96;
    var str = "";
    var x = seed >>> 0;
    for (var i = 0; i < length; i++) {
      x = lcgNext(x);
      str += STREAM_CHARS[(x >>> 24) & 0xf];
    }
    return str;
  }

  // Şifre metni hissi: aynı akıştan türetilmiş, "·" ile gruplanmış ikili kodlar.
  function makeCipherStream(seed, length) {
    length = length || 96;
    var str = "";
    var x = seed >>> 0;
    for (var i = 0; i < length; i++) {
      x = lcgNext(x);
      str += STREAM_CHARS[(x >>> 24) & 0xf];
      if (i % 2 === 1) str += "·";
    }
    return str;
  }

  // --- Dişli düzeni: 12 adet, değişen boyut/diş/yön/hız. ---
  var GEAR_COUNT = 12;
  var TEETH_VARIANTS = [12, 14, 16];

  function buildGearSpecs() {
    var specs = [];
    for (var i = 0; i < GEAR_COUNT; i++) {
      var t = i / (GEAR_COUNT - 1);
      var x = 36 + t * (LOGICAL_W - 72);
      var row = i % 3;
      var y = 50 + row * 95 + Math.sin(t * Math.PI * 4) * 18;
      var r = 14 + ((i * 7) % 5) * 5; // 14..34 arasında değişen boyut
      var teeth = TEETH_VARIANTS[i % TEETH_VARIANTS.length];
      var dir = i % 2 === 0 ? 1 : -1; // bitişik dişliler zıt yönde
      var speed = 0.5 + ((i * 3) % 5) * 0.2;
      specs.push({ x: x, y: y, r: r, teeth: teeth, dir: dir, speed: speed });
    }
    return specs;
  }

  // --- Dişli gövdesi (sabit kısım) bir kez offscreen canvas'a çizilir. ---
  var SPRITE_SIZE = 112;
  var SPRITE_OUTER_R = 46;

  function drawGearBody(ctx, teeth) {
    var outerR = SPRITE_OUTER_R;
    var innerR = outerR * 0.72;
    var hubR = outerR * 0.28;
    var toothLen = outerR - innerR;

    ctx.fillStyle = GEAR_COLOR;
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.fill();

    for (var ti = 0; ti < teeth; ti++) {
      var ta = (ti / teeth) * Math.PI * 2;
      var toothW = ((2 * Math.PI * innerR) / teeth) * 0.55;
      ctx.save();
      ctx.rotate(ta);
      ctx.fillRect(-toothW / 2, -outerR, toothW, toothLen + 1);
      ctx.restore();
    }

    // Kenar vurgusu: göbek çevresine yakın açık ton.
    ctx.strokeStyle = GEAR_COLOR_LIGHT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, innerR - 1.5, 0, Math.PI * 2);
    ctx.stroke();

    // Koyu çevre çizgisi.
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.stroke();

    // Göbek deliği (arkası görünür).
    ctx.fillStyle = BG_COLOR;
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.stroke();
  }

  function createGearSprite(teeth) {
    var c = document.createElement("canvas");
    c.width = SPRITE_SIZE;
    c.height = SPRITE_SIZE;
    var ctx = c.getContext("2d");
    ctx.translate(SPRITE_SIZE / 2, SPRITE_SIZE / 2);
    drawGearBody(ctx, teeth);
    return c;
  }

  function buildGearSprites() {
    var sprites = {};
    for (var i = 0; i < TEETH_VARIANTS.length; i++) {
      var teeth = TEETH_VARIANTS[i];
      sprites[teeth] = createGearSprite(teeth);
    }
    return sprites;
  }

  // --- Ray ızgarası (sabit kısım) bir kez offscreen canvas'a çizilir. ---
  function createRailsSprite() {
    var c = document.createElement("canvas");
    c.width = LOGICAL_W;
    c.height = LOGICAL_H;
    var ctx = c.getContext("2d");

    function drawRail(x1, y1, x2, y2) {
      ctx.strokeStyle = RAIL_COLOR_DARK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.strokeStyle = RAIL_COLOR_LIGHT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    var hLines = [CELL_H, CELL_H * 2, CELL_H * 3];
    for (var hi = 0; hi < hLines.length; hi++) {
      drawRail(0, hLines[hi], LOGICAL_W, hLines[hi]);
    }
    for (var col = 1; col < COLS; col++) {
      var x = col * CELL_W;
      drawRail(x, 0, x, LOGICAL_H);
    }

    return c;
  }

  function Transition(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.active = false;
    this.skipRequested = false;
    this.hexStream = makeHexStream(2026, 128);
    this.cipherStream = makeCipherStream(777, 80);
    this.gearSpecs = buildGearSpecs();
    this.gearSprites = buildGearSprites();
    this.railsSprite = createRailsSprite();
    this._onKeydown = this._onKeydown.bind(this);
    this._onClick = this._onClick.bind(this);
  }

  Transition.prototype._resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var w = window.innerWidth;
    var h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Mantıksal 640x288'i ekrana oranla ölçekle (letterbox yok, basitçe doldur).
    this.scaleX = w / LOGICAL_W;
    this.scaleY = h / LOGICAL_H;
  };

  Transition.prototype._onKeydown = function (ev) {
    if (ev.key === "Escape" || ev.key === " " || ev.code === "Space") {
      this.skipRequested = true;
    }
  };

  Transition.prototype._onClick = function () {
    this.skipRequested = true;
  };

  // Dişliler ctx.scale(sx,sy) altında (1, sx/sy) ile LOKAL olarak düzeltilir,
  // böylece tuvalin en-boy oranı ne olursa olsun daire YUVARLAK kalır
  // (KÖK NEDEN: önceki kod tek bir sx,sy ölçeğini daireye de uyguluyordu,
  // sx != sy olduğunda daire oval çıkıyordu).
  Transition.prototype._drawGears = function (elapsedMs, sx, sy) {
    var ctx = this.ctx;
    var k = sx / sy;
    for (var i = 0; i < this.gearSpecs.length; i++) {
      var g = this.gearSpecs[i];
      var sprite = this.gearSprites[g.teeth];
      var angle = (elapsedMs / 1000) * g.dir * g.speed;
      var scaleFactor = g.r / SPRITE_OUTER_R;
      var destSize = SPRITE_SIZE * scaleFactor;

      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.scale(1, k);
      ctx.rotate(angle);
      ctx.drawImage(sprite, -destSize / 2, -destSize / 2, destSize, destSize);
      ctx.restore();
    }
  };

  Transition.prototype._drawRailLights = function (elapsedMs, sx, sy) {
    var ctx = this.ctx;
    var k = sx / sy;
    var dots = [
      { axis: "h", pos: CELL_H, speed: 90 },
      { axis: "h", pos: CELL_H * 3, speed: -70 },
      { axis: "v", pos: CELL_W * 2, speed: 60 },
      { axis: "v", pos: CELL_W * 6, speed: -50 }
    ];
    for (var i = 0; i < dots.length; i++) {
      var dot = dots[i];
      var t = (elapsedMs / 1000) * dot.speed;
      var x, y;
      if (dot.axis === "h") {
        x = ((t % LOGICAL_W) + LOGICAL_W) % LOGICAL_W;
        y = dot.pos;
      } else {
        y = ((t % LOGICAL_H) + LOGICAL_H) % LOGICAL_H;
        x = dot.pos;
      }

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, k);

      var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 7);
      glow.addColorStop(0, CODE_COLOR_BRIGHT);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = CODE_COLOR_BRIGHT;
      ctx.beginPath();
      ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  };

  Transition.prototype._drawColumnLayer = function (elapsedMs, cfg) {
    var ctx = this.ctx;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = cfg.color;
    ctx.globalAlpha = cfg.alpha;
    for (var c = 0; c < cfg.count; c++) {
      var x = cfg.xStart + c * cfg.xStep;
      var speed = cfg.speedBase * (1 + (c % 3) * 0.18);
      var scrollPx = (elapsedMs / 1000) * speed;
      var baseOffset = c * 7;
      for (var row = 0; row < cfg.rows; row++) {
        var y = ((row * cfg.rowH + scrollPx) % (cfg.rows * cfg.rowH)) - cfg.rowH;
        var idx = (baseOffset + row) % cfg.stream.length;
        ctx.fillText(cfg.stream[idx], x, y);
      }
    }
    ctx.globalAlpha = 1;
  };

  // Tüm genişliği kaplayan, iki katmanlı (önde parlak/az, geride soluk/çok)
  // akan kod sütunları. Yalnız üretilmiş karakterler, gerçek veri yok.
  Transition.prototype._drawCodeColumns = function (elapsedMs) {
    var rowH = 13;
    var rows = Math.ceil(LOGICAL_H / rowH) + 2;

    this._drawColumnLayer(elapsedMs, {
      count: 9,
      speedBase: 40,
      alpha: 0.28,
      color: CODE_COLOR_DIM,
      stream: this.hexStream,
      rows: rows,
      rowH: rowH,
      xStart: 20,
      xStep: (LOGICAL_W - 40) / 8
    });

    this._drawColumnLayer(elapsedMs, {
      count: 5,
      speedBase: 85,
      alpha: 0.85,
      color: CODE_COLOR_BRIGHT,
      stream: this.cipherStream,
      rows: rows,
      rowH: rowH,
      xStart: 48,
      xStep: (LOGICAL_W - 96) / 4
    });
  };

  Transition.prototype._drawBackdrop = function (elapsedMs) {
    var ctx = this.ctx;
    var sx = this.scaleX, sy = this.scaleY;
    ctx.save();
    ctx.scale(sx, sy);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

    // Sabit ray ızgarası: önceden çizilmiş sprite'ın kopyası (bir kez üretildi).
    ctx.drawImage(this.railsSprite, 0, 0, LOGICAL_W, LOGICAL_H);
    this._drawRailLights(elapsedMs, sx, sy);

    this._drawGears(elapsedMs, sx, sy);
    this._drawCodeColumns(elapsedMs);

    ctx.restore();
  };

  Transition.prototype._drawBlocks = function (progress) {
    var ctx = this.ctx;
    var sx = this.scaleX, sy = this.scaleY;
    var sourceMap = this._sourceMap;

    ctx.save();
    ctx.scale(sx, sy);

    for (var dest = 0; dest < CELLS; dest++) {
      var src = sourceMap[dest];
      var from = cellCenter(src);
      var to = cellCenter(dest);

      var bump = Math.sin(Math.PI * progress);
      var scale = 1 - (1 - MIN_SCALE) * bump;

      // Kavis: dik yönde bir ofset, bump ile birlikte büyüyüp küçülür.
      var dx = to.x - from.x;
      var dy = to.y - from.y;
      var nx = -dy, ny = dx;
      var len = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= len; ny /= len;
      var curveAmount = Math.min(18, len * 0.25) * bump;

      var cx = from.x + dx * progress + nx * curveAmount;
      var cy = from.y + dy * progress + ny * curveAmount;

      var w = CELL_W * 0.86 * scale;
      var h = CELL_H * 0.86 * scale;
      var colorIdx = dest % BLOCK_COLORS.length;

      // Yumuşak gölge (bloğun hafifçe altında).
      ctx.fillStyle = BLOCK_SHADOW_COLOR;
      ctx.fillRect(cx - w / 2, cy - h / 2 + 4, w, h);

      ctx.fillStyle = BLOCK_COLORS[colorIdx];
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = 1.5;
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);

      // Kenar vurgusu: üst+sol kenar, ışık alan kenar hissi.
      ctx.strokeStyle = BLOCK_HIGHLIGHTS[colorIdx];
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, cy + h / 2);
      ctx.lineTo(cx - w / 2, cy - h / 2);
      ctx.lineTo(cx + w / 2, cy - h / 2);
      ctx.stroke();
    }

    ctx.restore();
  };

  /**
   * @param {{duration:number, reverse:boolean, onDone:function}} opts
   */
  Transition.prototype.play = function (opts) {
    var self = this;
    var duration = opts.duration;
    var sourceMap = opts.reverse ? REVERSE_SOURCE : FORWARD_SOURCE;
    this._sourceMap = sourceMap;
    this.active = true;
    this.skipRequested = false;

    this._resize();
    this.canvas.classList.add("active");
    document.addEventListener("keydown", this._onKeydown);
    this.canvas.addEventListener("click", this._onClick);

    var start = null;

    function frame(now) {
      if (!start) start = now;
      var elapsed = now - start;
      var progress = self.skipRequested ? 1 : Math.min(1, elapsed / duration);
      var eased = easeInOutQuad(progress);

      self._drawBackdrop(elapsed);
      self._drawBlocks(eased);

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        self._finish(opts.onDone);
      }
    }

    requestAnimationFrame(frame);
  };

  Transition.prototype._finish = function (onDone) {
    this.active = false;
    this.canvas.classList.remove("active");
    document.removeEventListener("keydown", this._onKeydown);
    this.canvas.removeEventListener("click", this._onClick);
    if (onDone) onDone();
  };

  window.AKTransition = {
    create: function (canvas) {
      return new Transition(canvas);
    },
    supportsFull: function () {
      var reduced = window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var lowCpu = (navigator.hardwareConcurrency || 4) <= 2;
      return !reduced && !lowCpu;
    }
  };
})();
