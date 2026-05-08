(function () {
  'use strict';

  // ─── Schedule templates ───────────────────────────────────────────
  // Each template defines a sequence of steps relative to the serve
  // time (offsetMin in minutes from serve, negative = before serve).
  // Templates are displayed in the home screen as cook options.
  // ─────────────────────────────────────────────────────────────────

  var TEMPLATES = {

    // ─── 烤串 / Skewers — quick high-heat charcoal ─────────────────
    'skewers': {
      id: 'skewers',
      icon: '🍢',
      name: 'Skewers',
      name_zh: '烤串',
      tagline: 'High-heat charcoal · 30 min',
      tagline_zh: '高温炭火 · 30 分钟',
      summary: 'Lamb / chicken / beef skewers over hot lump charcoal. Hands-on, party-style.',
      summary_zh: '羊肉 / 鸡肉 / 牛肉串过明火，热闹的炭烤聚会做法。',
      cookHours: 1.0,
      schedule: [
        { offsetMin: -60, dur: 25, title: '🔥 Light charcoal', title_zh: '引炭',
          body: 'Chimney with hardwood lump or briquettes. Wait until coals are fully ashed white-gray (~20–25 min).',
          body_zh: '引火筒装硬木块炭或机制炭。等炭面全白覆灰再倒（约 20–25 分）。' },
        { offsetMin: -35, dur: 5, title: '🪵 Set up grill', title_zh: '布置烤架',
          body: 'Spread coals evenly. Set grate 5–8 cm above coals. Brush grate clean, oil it lightly.',
          body_zh: '炭铺平。烤网离炭 5–8 cm。刷干净网架，薄涂一层油防粘。' },
        { offsetMin: -30, dur: 8, title: '🐑 Lamb skewers on', title_zh: '羊肉串下锅',
          body: 'Long-cooking meats first. Lay flat across grate, do not crowd. 3–4 min/side. Brush with oil if dry.',
          body_zh: '先烤难熟的羊肉。横向铺满，别挤。3–4 分钟一面。干了刷油。' },
        { offsetMin: -22, dur: 4, title: '🔄 Flip lamb', title_zh: '翻面',
          body: 'Lamb should have grill marks. Turn once — repeated flipping kills the crust.',
          body_zh: '羊肉表面有焦痕了。只翻一次 —— 频繁翻动会毁掉脆壳。' },
        { offsetMin: -18, dur: 6, title: '🐔 Chicken skewers on', title_zh: '鸡肉串下锅',
          body: 'Lamb off (rest on warm plate). Chicken on. 4–5 min/side, fully cooked through.',
          body_zh: '羊肉先取出放温盘。鸡肉上。4–5 分钟一面，必须完全熟透。' },
        { offsetMin: -10, dur: 5, title: '🐂 Beef + 🌽 sides on', title_zh: '牛肉 + 配菜',
          body: 'Chicken off. Beef skewers (2–3 min/side rare, 4 min medium) + corn / mantou / naan / mushrooms / peppers along edges.',
          body_zh: '鸡肉取出。牛肉串（三分 2–3 分 / 面，半熟 4 分）下锅，边上同时放玉米 / 馒头 / 烤饼 / 蘑菇 / 彩椒。' },
        { offsetMin: -3, dur: 3, title: '🌶️ Dust + plate', title_zh: '撒料装盘',
          body: 'Sprinkle cumin, chili powder, sesame, salt. Arrange on plate. Lime wedges on the side.',
          body_zh: '撒孜然、辣椒粉、芝麻、盐。装盘，柠檬角配着。' },
        { offsetMin: 0, dur: 60, title: '🍻 Eat', title_zh: '开吃',
          body: 'Hot off the grill. Wraps with naan / 馕 / lettuce / mantou. Cold beer.',
          body_zh: '趁热吃。馕 / 生菜 / 馒头夹着吃。配冰啤酒。' }
      ]
    },

    // ─── 鸡翅 / Wings — medium two-zone grill ──────────────────────
    'wings': {
      id: 'wings',
      icon: '🍗',
      name: 'Wings',
      name_zh: '鸡翅',
      tagline: 'Two-zone grill · ~75 min',
      tagline_zh: '双区烤 · 约 75 分钟',
      summary: 'Crispy-skin grilled wings, indirect-then-direct method. Dry-brined ahead is best.',
      summary_zh: '脆皮烤鸡翅，先间接后直火法。提前干腌一夜效果最佳。',
      cookHours: 1.5,
      schedule: [
        { offsetMin: -90, dur: 5, title: '🧂 Wings out of fridge', title_zh: '鸡翅出冰箱',
          body: 'If dry-brined yesterday: pat dry. If not: salt now (~1% by weight) + baking powder (1 tsp / 1 kg) for crispy skin. Toss with light oil.',
          body_zh: '昨天干腌过的：擦干。没腌的：现在抹盐（重量 1%）+ 泡打粉（1kg 1 茶匙）促脆皮。薄涂油。' },
        { offsetMin: -80, dur: 20, title: '🔥 Light grill', title_zh: '引火预热',
          body: 'Two-zone setup: charcoal on one side only. Target 200°C / 400°F at the indirect side. Lid down to preheat 15–20 min.',
          body_zh: '双区布炭：炭只放一边。目标间接区 200°C / 400°F。盖盖预热 15–20 分。' },
        { offsetMin: -60, dur: 5, title: '🍗 Wings on (indirect side)', title_zh: '鸡翅上架（间接区）',
          body: 'Place wings skin-up over the empty side, NOT over coals. Lid down. This renders fat without burning skin.',
          body_zh: '鸡翅皮朝上放在没炭那侧。盖盖。让脂肪慢慢渗出而不会糊皮。' },
        { offsetMin: -35, dur: 5, title: '🔄 Flip wings', title_zh: '翻面',
          body: 'Skin should look pale-gold and rendered. Flip skin-down briefly to color the underside.',
          body_zh: '此时皮应淡金色脂肪渗出。翻面让底部上色。' },
        { offsetMin: -20, dur: 10, title: '🔥 Move to direct heat', title_zh: '移到直火区',
          body: 'Move all wings over the coals, skin DOWN. 3–4 min for crispy skin. Watch closely — flares happen fast.',
          body_zh: '全部移到炭上，皮朝下。3–4 分钟出脆皮。盯紧，脂肪滴下起火很快。' },
        { offsetMin: -10, dur: 5, title: '🥣 Sauce (optional)', title_zh: '蘸酱（可选）',
          body: 'Toss in a bowl with sauce: buffalo, soy-honey-garlic, sweet chili, dry rub, etc. Or leave plain — they\'re great as-is.',
          body_zh: '想加酱就在大碗里拌：buffalo、蒜蓉蜂蜜、甜辣、干料粉等。也可以原味，本身就好吃。' },
        { offsetMin: -5, dur: 5, title: '🛌 Rest', title_zh: '静置',
          body: 'Let wings sit 3–5 min. The skin firms up further; juices redistribute.',
          body_zh: '静置 3–5 分钟。皮会更脆，肉汁回流。' },
        { offsetMin: 0, dur: 60, title: '🍽️ Serve', title_zh: '上桌',
          body: 'Pile high. Ranch / blue cheese / 蒜蓉酱 on the side. Celery sticks if going buffalo style.',
          body_zh: '堆盘。配 ranch / 蓝纹芝士酱 / 蒜蓉酱。Buffalo 风配芹菜条。' }
      ]
    },

    // ─── 五花 / Pork belly — medium-long ───────────────────────────
    'pork-belly': {
      id: 'pork-belly',
      icon: '🥓',
      name: 'Pork belly',
      name_zh: '五花肉',
      tagline: 'Crispy skin roast · ~3 h',
      tagline_zh: '脆皮烧肉 · 约 3 小时',
      summary: 'Cantonese-style siu yuk — crackling-crisp skin, juicy interior. Drum or oven both work.',
      summary_zh: '广式烧肉风格 —— 脆皮带响声，内里多汁。桶式炉或家用烤箱都可。',
      cookHours: 3.5,
      schedule: [
        { offsetMin: -210, dur: 15, title: '🔪 Score skin + dry brine', title_zh: '划皮 + 干腌',
          body: 'Pat skin bone-dry with paper towel. Score in 3 mm grid, just into fat (NOT into meat). Rub salt heavily on skin. Salt + 5-spice on meat side.',
          body_zh: '皮面用厨房纸擦到干透。在皮上划 3 mm 网格，只切到脂肪层（别切到肉）。皮面厚抹盐。肉面盐 + 五香粉。' },
        { offsetMin: -195, dur: 60, title: '🌬️ Air-dry skin', title_zh: '风干皮',
          body: 'Place uncovered on rack in fridge for 1 h minimum (overnight ideal). Skin must be DRY for crackling.',
          body_zh: '裸放冰箱风干至少 1 小时（隔夜最佳）。皮一定要干，否则不会脆。' },
        { offsetMin: -135, dur: 15, title: '🔥 Light smoker / oven', title_zh: '引火 / 预热',
          body: 'Smoker target 250°F / 121°C with 4 coals; or oven 230°C / 446°F (low-rack) for the start phase.',
          body_zh: '桶炉目标 250°F / 121°C，4 炭；或烤箱 230°C / 446°F，下层架。' },
        { offsetMin: -120, dur: 5, title: '🥓 Belly on, skin UP', title_zh: '五花上架，皮朝上',
          body: 'Wipe excess salt off skin. Brush skin with thin layer oil. Place skin-up. The salt crust above acts as insulator.',
          body_zh: '皮上多余的盐擦掉。皮上薄刷一层油。皮朝上摆。这层盐壳像绝热层。' },
        { offsetMin: -75, dur: 10, title: '🌡️ Halfway check', title_zh: '中途检查',
          body: 'Internal should be ~55°C / 130°F. Skin still pale. Rotate the piece 180° for even color.',
          body_zh: '内温应 ~55°C / 130°F 左右。皮还是浅色。把肉块掉头 180° 让上色均匀。' },
        { offsetMin: -45, dur: 5, title: '🔥 Crank heat for crackling', title_zh: '升温催皮',
          body: 'Smoker → 300°F / 149°C with 6 coals (or oven → 250°C / 482°F top-rack with broiler/grill on). Skin will start bubbling.',
          body_zh: '桶炉升 300°F / 149°C，加到 6 炭（烤箱升 250°C / 482°F，移上层架开烤架 / broil）。皮开始起泡。' },
        { offsetMin: -25, dur: 15, title: '👁️ Watch closely', title_zh: '盯紧',
          body: 'Skin transforms in last 15 min — pale → tan → mahogany. Pull any moment past mahogany or it burns. Internal target 70°C / 158°F.',
          body_zh: '最后 15 分钟皮快速变色 —— 浅 → 浅棕 → 红棕。过了红棕就糊。内温目标 70°C / 158°F。' },
        { offsetMin: -10, dur: 5, title: '🛌 Rest skin-up', title_zh: '静置皮朝上',
          body: 'Pull. Rest skin-UP, no foil (covering = soggy skin). 8–10 min.',
          body_zh: '出炉。皮朝上静置，绝对不盖锡纸（盖了皮会回软）。8–10 分钟。' },
        { offsetMin: -3, dur: 3, title: '🔪 Slice through skin', title_zh: '切片',
          body: 'Use heavy cleaver. Slice against grain into 1.5 cm strips, then cube or leave as fingers. Listen for the crack.',
          body_zh: '重菜刀。横纹切 1.5 cm 条，再切成方块或保留成指条。听皮的脆响。' },
        { offsetMin: 0, dur: 60, title: '🍽️ Serve', title_zh: '上桌',
          body: 'Hot. With mustard or hoisin / 海鲜酱 dip. Steamed rice, pickled greens.',
          body_zh: '趁热吃。配芥末或海鲜酱。配米饭和爽口腌菜。' }
      ]
    },

    // ─── Brisket + Picanha — the long haul ─────────────────────────
    'brisket-picanha': {
      id: 'brisket-picanha',
      icon: '🥩',
      name: 'Brisket + Picanha',
      name_zh: '牛胸 + Picanha',
      tagline: 'Low-and-slow + sear · 12 h',
      tagline_zh: '低慢 + 爆煎 · 12 小时',
      summary: '4.3 kg brisket low-and-slow on the lower rack, 1.8 kg picanha reverse-seared on the upper, sides last hour. Drum smoker.',
      summary_zh: '4.3 kg 牛胸下层架低慢烤，1.8 kg Picanha 上层架反向煎，最后一小时上配菜。桶式烟熏炉方案。',
      cookHours: 12,
      schedule: [
        { offsetMin: -720, dur: 30, title: '🔥 Light smoker', title_zh: '引火点炭',
          body: 'Chimney with 4 charcoal pieces. Target pit 250°F / 121°C. Add smoking wood: oak, hickory, cherry, or a mix.',
          body_zh: '引火筒装 4 块炭，目标桶温 250°F / 121°C。加 2 块橡木 / 胡桃木 / 樱桃木块。' },
        { offsetMin: -690, dur: 5, title: '🥩 Brisket on (lower rack)', title_zh: '牛胸下层架',
          body: 'Brisket on lower rack, fat-side DOWN. Thick point end toward the hotter side. Probe in thickest part of the flat. Pit 250°F / 121°C. Do not open often the first few hours.',
          body_zh: '牛胸下层架，脂肪向下。厚的 point 端朝火源较旺一侧。探针插 flat 最厚处。桶温 250°F / 121°C。前几小时少开盖。' },
        { offsetMin: -510, dur: 5, title: '💧 Brisket spritz check', title_zh: 'Brisket 检查 / 喷雾',
          body: 'Open quickly. Check bark. If edges look dry, spritz with water / apple juice / beef broth. Close. Pit 250°F / 121°C.',
          body_zh: '快速开盖检查树皮。边缘干了喷水 / 苹果汁 / 牛骨汤。立刻盖回。桶温保持。' },
        { offsetMin: -360, dur: 60, title: '📦 Wrap brisket window', title_zh: '包裹时段',
          body: 'Wrap when bark is dark brown to nearly black, fat is soft, internal 160–170°F / 71–77°C. Butcher paper preferred (keeps bark), foil for speed. Optional small splash of beef tallow / broth — do not flood. Pit 250°F / 121°C.',
          body_zh: '当树皮深棕近黑、脂肪软、内温 71–77°C 时包：粉色屠夫纸（保留树皮，首选）或铝箔（更快）。可选少量牛油 / 高汤，别灌。桶温保持。' },
        { offsetMin: -240, dur: 5, title: '🌡️ Brisket progress checkpoint', title_zh: 'Brisket 进度检查',
          body: 'Above 180°F / 82°C: stay at 250°F / 121°C. Below 175–180°F / 79–82°C: bump pit to 300°F / 149°C with 6 coals for 60–90 min. Recovery: if below 185°F / 85°C, escalate to 300°F immediately and stay wrapped.',
          body_zh: '过 180°F / 82°C：维持 250°F。低于 79–82°C：加到 6 炭飙 300°F / 149°C 推 60–90 分钟。低于 85°C 立即升温保包。' },
        { offsetMin: -180, dur: 60, title: '🥩 Brisket finish window — start probing', title_zh: 'Brisket 出炉时段，开始测嫩',
          body: 'Target internal 200–205°F / 93–96°C. Real test is tenderness — probe should slide into both flat AND point with almost no resistance, like room-temp butter. When done: vent wrap 10 min, rewrap tight, hold in cooler/oven 140–160°F / 60–71°C until 5:10 PM.',
          body_zh: '目标内温 93–96°C。但 probe 像插室温黄油那样无阻力才是真信号。出炉后：开包散气 10 分钟、紧包、保温箱或烤箱保温 60–71°C 到 5:10 PM。' },
        { offsetMin: -165, dur: 10, title: '🥔 Prep potatoes', title_zh: '土豆预处理',
          body: 'Cut into 3–4 cm chunks. Boil or steam 8–12 min until edges just soften. Drain well. Toss with oil, salt, black pepper, garlic powder, optional rosemary or paprika.',
          body_zh: '切 3–4 cm 块。煮 / 蒸 8–12 分钟到边缘微软。沥干。拌油、盐、黑胡椒、蒜粉，可选迷迭香 / 红椒粉。' },
        { offsetMin: -135, dur: 10, title: '🥩 Picanha out of fridge', title_zh: 'Picanha 出冰箱',
          body: 'Pat dry. Add coarse black pepper. Do NOT coat fat cap with wet sauce — it will not crisp.',
          body_zh: '擦干。撒粗黑胡椒。脂肪盖不要刷湿酱（影响焦化）。' },
        { offsetMin: -120, dur: 60, title: '🥩 Picanha + 🥔 potatoes on', title_zh: 'Picanha + 土豆下锅',
          body: 'Picanha upper rack, fat cap DOWN (heat from below renders the fat and protects the meat). Potatoes lower rack. Pit 250°F / 121°C, 4 coals. Smoke picanha until internal 120–125°F / 49–52°C (about 60–90 min).',
          body_zh: 'Picanha 上层架，脂肪盖朝下（从下方烤化脂肪并保护肉）。土豆下层架。桶 250°F / 121°C，4 炭。Picanha 烤到中心 49–52°C（约 60–90 分）。' },
        { offsetMin: -60, dur: 5, title: '🌡️ Picanha temp check', title_zh: 'Picanha 测温',
          body: 'At 120–125°F / 49–52°C: pull, rest briefly, prep to sear. Not yet: keep going. Do NOT exceed 125°F / 52°C — sear will add ~10°F more.',
          body_zh: '到 49–52°C：拉出短暂静置，准备煎。没到继续。绝对不要超过 52°C —— 煎还会再升 10°F。' },
        { offsetMin: -55, dur: 5, title: '🔥 Bump smoker to 300°F / 149°C', title_zh: '桶温升到 300°F',
          body: 'Add charcoal to 6 pieces total. Spread potatoes for browning (not steaming). Prep bell peppers (large pieces, oil/salt/pepper) and zucchini (1.5–2 cm thick — do not slice thin).',
          body_zh: '加炭到 6 块。土豆铺开促上色（别堆）。准备彩椒（大块，油盐胡椒）和西葫芦（1.5–2 cm 厚片，别切薄）。' },
        { offsetMin: -45, dur: 30, title: '🫑 Bell peppers on', title_zh: '彩椒下锅',
          body: 'Bell peppers at 300°F / 149°C. Target 25–35 min until softened with light char.',
          body_zh: '彩椒 300°F / 149°C。25–35 分钟到柔软微焦。' },
        { offsetMin: -35, dur: 20, title: '🥒 Zucchini on', title_zh: '西葫芦下锅',
          body: 'Zucchini at 300°F / 149°C. Target 15–20 min. Pull while still firm — they collapse fast.',
          body_zh: '西葫芦 300°F / 149°C。15–20 分钟。还有口感时拉出 —— 容易塌。' },
        { offsetMin: -30, dur: 8, title: '🔥 Sear picanha', title_zh: '爆煎 picanha',
          body: 'Direct charcoal / cast iron / hot grill / torch / hottest spot. Fat cap DOWN first 2–4 min, then meat side 1–2 min/side. Final internal 130–135°F / 54–57°C (medium-rare to medium). Watch flare-ups — move meat aside if flames lick it.',
          body_zh: '炭火直烤 / 铸铁锅 / 喷枪 / 最热区域。脂肪盖先 2–4 分，再肉面 1–2 分 / 面。最终 54–57°C（三分到半熟）。脂肪滴下起火就移开。' },
        { offsetMin: -20, dur: 10, title: '🛌 Rest picanha + take brisket from holding', title_zh: 'Picanha 静置 + 取 brisket',
          body: 'Rest picanha 10–15 min loosely tented in foil. Take brisket out of cooler/oven holding. Get knife and board ready.',
          body_zh: 'Picanha 铝箔松盖静置 10–15 分钟。从保温箱 / 烤箱取出 brisket。准备切刀切板。' },
        { offsetMin: -10, dur: 10, title: '🔪 Slice meats', title_zh: '切肉',
          body: 'Brisket: slice flat against the grain, pencil-thick (~6 mm). Point thicker or cube it. Picanha: cut WITH the grain into steak portions, then slice each steak AGAINST the grain for serving.',
          body_zh: 'Brisket：flat 横纹切铅笔粗（~6 mm）。Point 切厚或切方块。Picanha：先顺纹切牛排块，再每块横纹切片上桌。' },
        { offsetMin: 0, dur: 60, title: '🍽️ Serve dinner', title_zh: '上桌开吃',
          body: 'Plate brisket first, picanha second, sides last. Sit. Eat. Take a photo for the group chat.',
          body_zh: '先 brisket，再 picanha，最后配菜。坐下。吃。拍照发群。' }
      ]
    }
  };

  // Order in which menus are shown on the home screen.
  var TEMPLATE_ORDER = ['skewers', 'wings', 'pork-belly', 'brisket-picanha'];

  function getTemplate(id) {
    return TEMPLATES[id] || null;
  }

  function listTemplates() {
    return TEMPLATE_ORDER.map(function (id) { return TEMPLATES[id]; });
  }

  window.SmokerSim = window.SmokerSim || {};
  window.SmokerSim.Menu = {
    TEMPLATES: TEMPLATES,
    TEMPLATE_ORDER: TEMPLATE_ORDER,
    get: getTemplate,
    list: listTemplates
  };
})();
