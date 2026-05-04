(function () {
  'use strict';

  // ─── Schedule template: Brisket + Picanha + sides, drum smoker ───
  // offsetMin = minutes from serve time (negative = before serve)
  // dur = event duration in minutes (used for calendar block length)
  // Source: hand-tuned from Smoker Dynamics physics + user's pasted plan.
  var SCHEDULE = [
    {
      offsetMin: -720, dur: 30,
      title: '🔥 Light smoker', title_zh: '引火点炭',
      body: 'Chimney with 4 charcoal pieces. Target pit 250°F / 121°C. Add smoking wood: oak, hickory, cherry, or a mix.',
      body_zh: '引火筒装 4 块炭，目标桶温 250°F / 121°C。加 2 块橡木 / 胡桃木 / 樱桃木块。'
    },
    {
      offsetMin: -690, dur: 5,
      title: '🥩 Brisket on (lower rack)', title_zh: '牛胸下层架',
      body: 'Brisket on lower rack, fat-side DOWN. Thick point end toward the hotter side. Probe in thickest part of the flat. Pit 250°F / 121°C. Do not open often the first few hours.',
      body_zh: '牛胸下层架，脂肪向下。厚的 point 端朝火源较旺一侧。探针插 flat 最厚处。桶温 250°F / 121°C。前几小时少开盖。'
    },
    {
      offsetMin: -510, dur: 5,
      title: '💧 Brisket spritz check', title_zh: 'Brisket 检查 / 喷雾',
      body: 'Open quickly. Check bark. If edges look dry, spritz with water / apple juice / beef broth. Close. Pit 250°F / 121°C.',
      body_zh: '快速开盖检查树皮。边缘干了喷水 / 苹果汁 / 牛骨汤。立刻盖回。桶温保持。'
    },
    {
      offsetMin: -360, dur: 60,
      title: '📦 Wrap brisket window', title_zh: '包裹时段',
      body: 'Wrap when bark is dark brown to nearly black, fat is soft, internal 160–170°F / 71–77°C. Butcher paper preferred (keeps bark), foil for speed. Optional small splash of beef tallow / broth — do not flood. Pit 250°F / 121°C.',
      body_zh: '当树皮深棕近黑、脂肪软、内温 71–77°C 时包：粉色屠夫纸（保留树皮，首选）或铝箔（更快）。可选少量牛油 / 高汤，别灌。桶温保持。'
    },
    {
      offsetMin: -240, dur: 5,
      title: '🌡️ Brisket progress checkpoint', title_zh: 'Brisket 进度检查',
      body: 'Above 180°F / 82°C: stay at 250°F / 121°C. Below 175–180°F / 79–82°C: bump pit to 300°F / 149°C with 6 coals for 60–90 min. Recovery: if below 185°F / 85°C, escalate to 300°F immediately and stay wrapped.',
      body_zh: '过 180°F / 82°C：维持 250°F。低于 79–82°C：加到 6 炭飙 300°F / 149°C 推 60–90 分钟。低于 85°C 立即升温保包。'
    },
    {
      offsetMin: -180, dur: 60,
      title: '🥩 Brisket finish window — start probing', title_zh: 'Brisket 出炉时段，开始测嫩',
      body: 'Target internal 200–205°F / 93–96°C. Real test is tenderness — probe should slide into both flat AND point with almost no resistance, like room-temp butter. When done: vent wrap 10 min, rewrap tight, hold in cooler/oven 140–160°F / 60–71°C until 5:10 PM.',
      body_zh: '目标内温 93–96°C。但 probe 像插室温黄油那样无阻力才是真信号。出炉后：开包散气 10 分钟、紧包、保温箱或烤箱保温 60–71°C 到 5:10 PM。'
    },
    {
      offsetMin: -165, dur: 10,
      title: '🥔 Prep potatoes', title_zh: '土豆预处理',
      body: 'Cut into 3–4 cm chunks. Boil or steam 8–12 min until edges just soften. Drain well. Toss with oil, salt, black pepper, garlic powder, optional rosemary or paprika.',
      body_zh: '切 3–4 cm 块。煮 / 蒸 8–12 分钟到边缘微软。沥干。拌油、盐、黑胡椒、蒜粉，可选迷迭香 / 红椒粉。'
    },
    {
      offsetMin: -135, dur: 10,
      title: '🥩 Picanha out of fridge', title_zh: 'Picanha 出冰箱',
      body: 'Pat dry. Add coarse black pepper. Do NOT coat fat cap with wet sauce — it will not crisp.',
      body_zh: '擦干。撒粗黑胡椒。脂肪盖不要刷湿酱（影响焦化）。'
    },
    {
      offsetMin: -120, dur: 60,
      title: '🥩 Picanha + 🥔 potatoes on', title_zh: 'Picanha + 土豆下锅',
      body: 'Picanha upper rack, fat cap DOWN (heat from below renders the fat and protects the meat). Potatoes lower rack. Pit 250°F / 121°C, 4 coals. Smoke picanha until internal 120–125°F / 49–52°C (about 60–90 min).',
      body_zh: 'Picanha 上层架，脂肪盖朝下（从下方烤化脂肪并保护肉）。土豆下层架。桶 250°F / 121°C，4 炭。Picanha 烤到中心 49–52°C（约 60–90 分）。'
    },
    {
      offsetMin: -60, dur: 5,
      title: '🌡️ Picanha temp check', title_zh: 'Picanha 测温',
      body: 'At 120–125°F / 49–52°C: pull, rest briefly, prep to sear. Not yet: keep going. Do NOT exceed 125°F / 52°C — sear will add ~10°F more.',
      body_zh: '到 49–52°C：拉出短暂静置，准备煎。没到继续。绝对不要超过 52°C —— 煎还会再升 10°F。'
    },
    {
      offsetMin: -55, dur: 5,
      title: '🔥 Bump smoker to 300°F / 149°C', title_zh: '桶温升到 300°F',
      body: 'Add charcoal to 6 pieces total. Spread potatoes for browning (not steaming). Prep bell peppers (large pieces, oil/salt/pepper) and zucchini (1.5–2 cm thick — do not slice thin).',
      body_zh: '加炭到 6 块。土豆铺开促上色（别堆）。准备彩椒（大块，油盐胡椒）和西葫芦（1.5–2 cm 厚片，别切薄）。'
    },
    {
      offsetMin: -45, dur: 30,
      title: '🫑 Bell peppers on', title_zh: '彩椒下锅',
      body: 'Bell peppers at 300°F / 149°C. Target 25–35 min until softened with light char.',
      body_zh: '彩椒 300°F / 149°C。25–35 分钟到柔软微焦。'
    },
    {
      offsetMin: -35, dur: 20,
      title: '🥒 Zucchini on', title_zh: '西葫芦下锅',
      body: 'Zucchini at 300°F / 149°C. Target 15–20 min. Pull while still firm — they collapse fast.',
      body_zh: '西葫芦 300°F / 149°C。15–20 分钟。还有口感时拉出 —— 容易塌。'
    },
    {
      offsetMin: -30, dur: 8,
      title: '🔥 Sear picanha', title_zh: '爆煎 picanha',
      body: 'Direct charcoal / cast iron / hot grill / torch / hottest spot. Fat cap DOWN first 2–4 min, then meat side 1–2 min/side. Final internal 130–135°F / 54–57°C (medium-rare to medium). Watch flare-ups — move meat aside if flames lick it.',
      body_zh: '炭火直烤 / 铸铁锅 / 喷枪 / 最热区域。脂肪盖先 2–4 分，再肉面 1–2 分 / 面。最终 54–57°C（三分到半熟）。脂肪滴下起火就移开。'
    },
    {
      offsetMin: -20, dur: 10,
      title: '🛌 Rest picanha + take brisket from holding', title_zh: 'Picanha 静置 + 取 brisket',
      body: 'Rest picanha 10–15 min loosely tented in foil. Take brisket out of cooler/oven holding. Get knife and board ready.',
      body_zh: 'Picanha 铝箔松盖静置 10–15 分钟。从保温箱 / 烤箱取出 brisket。准备切刀切板。'
    },
    {
      offsetMin: -10, dur: 10,
      title: '🔪 Slice meats', title_zh: '切肉',
      body: 'Brisket: slice flat against the grain, pencil-thick (~6 mm). Point thicker or cube it. Picanha: cut WITH the grain into steak portions, then slice each steak AGAINST the grain for serving.',
      body_zh: 'Brisket：flat 横纹切铅笔粗（~6 mm）。Point 切厚或切方块。Picanha：先顺纹切牛排块，再每块横纹切片上桌。'
    },
    {
      offsetMin: 0, dur: 60,
      title: '🍽️ Serve dinner', title_zh: '上桌开吃',
      body: 'Plate brisket first, picanha second, sides last. Sit. Eat. Take a photo for the group chat.',
      body_zh: '先 brisket，再 picanha，最后配菜。坐下。吃。拍照发群。'
    }
  ];

  function pad(n) { return String(n).padStart(2, '0'); }

  // RFC 5545 floating local time: YYYYMMDDTHHMMSS (no Z, no TZID)
  function fmtFloating(d) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
      + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function fmtUTCStamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
      + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }

  function fmtClock(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function fmtDay(d) {
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function buildEvents(serveAt) {
    return SCHEDULE.map(function (step, i) {
      var start = new Date(serveAt.getTime() + step.offsetMin * 60000);
      var end = new Date(start.getTime() + step.dur * 60000);
      return {
        index: i,
        offsetMin: step.offsetMin,
        title: step.title,
        title_zh: step.title_zh,
        body: step.body,
        body_zh: step.body_zh,
        start: start,
        end: end,
        clock: fmtClock(start),
        day: fmtDay(start),
        durMin: step.dur
      };
    });
  }

  // RFC 5545 escaping: backslash, semicolon, comma, newline
  function esc(s) {
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // Fold long lines: max 75 octets, continuation lines start with single space
  function fold(line) {
    if (line.length <= 75) return line;
    var out = [];
    var i = 0;
    while (i < line.length) {
      out.push(i === 0 ? line.slice(0, 75) : ' ' + line.slice(i, i + 74));
      i += (i === 0 ? 75 : 74);
    }
    return out.join('\r\n');
  }

  function buildICS(serveAt) {
    var events = buildEvents(serveAt);
    var stamp = fmtUTCStamp(new Date());
    var slug = fmtFloating(serveAt);
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BBQ-Master//Smoker Dynamics//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:BBQ Schedule · 烧烤时间表'
    ];
    events.forEach(function (e, i) {
      var summary = e.title + ' · ' + e.title_zh;
      var description = e.body + '\n\n' + e.body_zh;
      lines.push('BEGIN:VEVENT');
      lines.push(fold('UID:bbq-' + slug + '-' + i + '@smoker-dynamics'));
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART:' + fmtFloating(e.start));
      lines.push('DTEND:' + fmtFloating(e.end));
      lines.push(fold('SUMMARY:' + esc(summary)));
      lines.push(fold('DESCRIPTION:' + esc(description)));
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-PT5M');
      lines.push('ACTION:DISPLAY');
      lines.push(fold('DESCRIPTION:' + esc('In 5 min · 5 分钟后：' + e.title)));
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  function buildText(serveAt) {
    var events = buildEvents(serveAt);
    var lines = [
      '🔥 BBQ Smoking Schedule · 烧烤时间表',
      'Serving ' + fmtClock(serveAt) + ' · ' + fmtDay(serveAt),
      ''
    ];
    var lastDay = null;
    events.forEach(function (e) {
      if (e.day !== lastDay) {
        if (lastDay !== null) lines.push('');
        lines.push('— ' + e.day + ' —');
        lastDay = e.day;
      }
      lines.push(e.clock + '  ' + e.title + ' · ' + e.title_zh);
    });
    lines.push('');
    lines.push('Generated by Smoker Dynamics · 由烟熏动力学生成');
    return lines.join('\n');
  }

  window.SmokerSim = window.SmokerSim || {};
  window.SmokerSim.ICS = {
    SCHEDULE: SCHEDULE,
    buildEvents: buildEvents,
    buildICS: buildICS,
    buildText: buildText
  };
})();
