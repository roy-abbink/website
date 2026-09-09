(function () {
    var canvas = document.getElementById("sift-canvas");
    if (!canvas || !canvas.getContext) return;

    var ctx = canvas.getContext("2d");
    var W = canvas.width;
    var H = canvas.height;

    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var glyphs = "01ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz".split("");
    var COUNT = 46;
    var particles = [];

    var slots = [];
    var rows = 6;
    var slotW = W - 96;
    var slotH = 34;
    var startY = 70;
    var gapY = 56;
    for (var r = 0; r < rows; r++) {
        slots.push({ x: 48, y: startY + r * gapY, w: r === rows - 1 ? slotW * 0.55 : slotW });
    }

    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }

    for (var i = 0; i < COUNT; i++) {
        particles.push({
            x: rand(0, W),
            y: rand(0, H),
            vx: rand(-0.25, 0.25),
            vy: rand(-0.25, 0.25),
            glyph: glyphs[Math.floor(Math.random() * glyphs.length)],
            size: rand(10, 15),
            slot: i < rows ? i : -1,
            settled: false,
            hue: Math.random() < 0.5 ? "#8E6AD2" : "#D232FB"
        });
    }

    var start = null;
    var settleAt = 2600;
    var holdAt = 5200;
    var loopAt = 7600;

    function draw(ts) {
        if (!start) start = ts;
        var t = (ts - start) % loopAt;

        ctx.clearRect(0, 0, W, H);

        var settleProgress = Math.min(1, t / settleAt);
        var ease = 1 - Math.pow(1 - settleProgress, 3);

        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];

            if (p.slot >= 0) {
                var target = slots[p.slot];
                var tx = target.x + 18;
                var ty = target.y + slotH / 2;

                if (t < settleAt) {
                    p.x = p.x + (tx - p.x) * 0.02 * (1 + ease * 2) + Math.sin(t * 0.01 + i) * (1 - ease) * 0.6;
                    p.y = p.y + (ty - p.y) * 0.02 * (1 + ease * 2);
                } else {
                    p.x = tx;
                    p.y = ty;
                }
            } else {
                if (t < settleAt) {
                    p.x += p.vx;
                    p.y += p.vy;
                    if (p.x < 0 || p.x > W) p.vx *= -1;
                    if (p.y < 0 || p.y > H) p.vy *= -1;
                } else {
                    p.opacity = Math.max(0, 1 - (t - settleAt) / 400);
                }
            }

            var fadeOut = p.slot < 0 && t >= settleAt ? Math.max(0, 1 - (t - settleAt) / 400) : 1;
            if (fadeOut <= 0) continue;

            ctx.globalAlpha = fadeOut * (0.35 + ease * 0.5);
            ctx.fillStyle = p.hue;
            ctx.font = p.size + "px 'JetBrains Mono', monospace";
            ctx.fillText(p.glyph, p.x, p.y);
        }
        ctx.globalAlpha = 1;

        if (t > settleAt) {
            var revealT = Math.min(1, (t - settleAt) / 500);
            for (var r = 0; r < rows; r++) {
                var s = slots[r];
                var rowReveal = Math.max(0, Math.min(1, revealT * rows - r));
                if (rowReveal <= 0) continue;

                ctx.globalAlpha = rowReveal;
                ctx.strokeStyle = "rgba(142,106,210,0.35)";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.roundRect(s.x, s.y, s.w * rowReveal, slotH, 8);
                ctx.stroke();

                ctx.fillStyle = "rgba(142,106,210,0.10)";
                ctx.beginPath();
                ctx.roundRect(s.x, s.y, s.w * rowReveal, slotH, 8);
                ctx.fill();

                if (rowReveal > 0.8) {
                    ctx.strokeStyle = r < 2 ? "#5FA868" : "rgba(244,238,233,0.4)";
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    if (r < 2) {
                        ctx.arc(s.x + 18, s.y + slotH / 2, 7, 0, Math.PI * 2);
                        ctx.moveTo(s.x + 15, s.y + slotH / 2);
                        ctx.lineTo(s.x + 17.5, s.y + slotH / 2 + 2.5);
                        ctx.lineTo(s.x + 22, s.y + slotH / 2 - 3.5);
                    } else {
                        ctx.arc(s.x + 18, s.y + slotH / 2, 7, 0, Math.PI * 2);
                    }
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;
            }
        }

        if (!reduceMotion) {
            requestAnimationFrame(draw);
        }
    }

    if (reduceMotion) {
        start = 0;
        draw(settleAt + holdAt);
    } else {
        requestAnimationFrame(draw);
    }
})();
