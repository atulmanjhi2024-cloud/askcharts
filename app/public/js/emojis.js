// The Icons panel from TradingView's drawing bar: emojis by category (with recently used), stickers
// and line icons. Pick one, then click the chart to place it. Emojis show in the system's emoji
// font; the stickers and icons are drawn here.

const svg = (body) => `<svg viewBox="0 0 24 24">${body}</svg>`;
// Grapheme-aware split, so flags and skin-tone sequences stay whole.
const split = (s) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((x) => x.segment).filter((x) => x.trim());

export const EMOJI_CATEGORIES = [
  ["people", "Smiles & people", svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2M9 9.5v.5M15 9.5v.5"/>'),
    "😀😃😄😁😆😅😂🤣☺️😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🤩🥳😏😒😞😔😟😕🙁☹️😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👿👹👺🤡💩👻💀☠️👽👾🤖🎃😺😸😹😻😼😽🙀😿😾👋🤚🖐️✋🖖👌🤌🤏✌️🤞🤟🤘🤙👈👉👆🖕👇☝️👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏✍️💪🧠👀👁️👅👄💋👶🧒👦👧🧑👱👨🧔👩🧓👴👵🙍🙎🙅🙆💁🙋🧏🙇🤦🤷👮🕵️💂👷🤴👸👳👲🧕🤵👰🤰🤱👼🎅🤶🦸🦹🧙🧚🧛🧜🧝🧞🧟💆💇🚶🏃💃🕺👯🧖🧘🛀🛌👭👫👬💏💑👪"],
  ["nature", "Animals & nature", svg('<path d="M6 5l2.5 4M18 5l-2.5 4M5.5 13a6.5 6 0 0 0 13 0c0-3.3-2.9-5-6.5-5s-6.5 1.7-6.5 5zM9.5 12.5v.5M14.5 12.5v.5M10.5 16h3"/>'),
    "🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🕷️🦂🐢🐍🦎🦖🦕🐙🦑🦐🦞🦀🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🦍🐘🦛🦏🐪🐫🦒🦘🐃🐂🐄🐎🐖🐏🐑🦙🐐🦌🐕🐈🐓🦃🦚🦜🦢🦩🕊️🐇🦝🦨🦡🦦🦥🐁🐀🐿️🦔🐾🐉🐲🌵🎄🌲🌳🌴🌱🌿☘️🍀🍃🍂🍁🍄🐚🌾💐🌷🌹🥀🌺🌸🌼🌻🌞🌝🌛🌜🌚🌕🌖🌗🌘🌑🌒🌓🌔🌙🌎🌍🌏🪐💫⭐🌟✨⚡☄️💥🔥🌪️🌈☀️🌤️⛅☁️🌧️⛈️🌩️❄️☃️⛄💨💧💦☔🌊"],
  ["food", "Food & drink", svg('<path d="M4 13h16M5 13a7 7 0 0 1 14 0M4.5 16h15l-1 3.5h-13zM12 4v2"/>'),
    "🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶️🌽🥕🧄🧅🥔🍠🥐🥯🍞🥖🥨🧀🥚🍳🧈🥞🧇🥓🥩🍗🍖🌭🍔🍟🍕🥪🥙🧆🌮🌯🥗🥘🍝🍜🍲🍛🍣🍱🥟🍤🍙🍚🍘🍥🥠🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🍯🥛🍼☕🍵🧃🥤🍶🍺🍻🥂🍷🥃🍸🍹🧉🍾🧊🥄🍴🍽️🥣🥡🥢🧂"],
  ["activity", "Activity", svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5v17M6 6c2.5 2 3.5 4 3.5 6s-1 4-3.5 6M18 6c-2.5 2-3.5 4-3.5 6s1 4 3.5 6"/>'),
    "⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🪀🏓🏸🏒🏑🥍🏏🥅⛳🪁🏹🎣🤿🥊🥋🎽🛹🛼🛷⛸️🥌🎿⛷️🏂🏋️🤼🤸⛹️🤺🤾🏌️🏇🏄🏊🤽🚣🧗🚵🚴🏆🥇🥈🥉🏅🎖️🏵️🎗️🎫🎟️🎪🤹🎭🩰🎨🎬🎤🎧🎼🎹🥁🎷🎺🎸🪕🎻🎲♟️🎯🎳🎮🎰🧩"],
  ["travel", "Travel & places", svg('<path d="M13.5 10.5l6-6c.8-.8 2-.8 2.3 0 .3.4 0 1.4-.8 2.2l-6 6 1.5 7-1.5 1.5-3.2-5.8-3.3 3.3.5 2.5-1.2 1.2-1.6-3-3-1.6 1.2-1.2 2.5.5 3.3-3.3-5.8-3.2L5 4z"/>'),
    "🚗🚕🚙🚌🚎🏎️🚓🚑🚒🚐🚚🚛🚜🛴🚲🛵🏍️🚨🚔🚍🚘🚖🚡🚠🚟🚃🚋🚞🚝🚄🚅🚈🚂🚆🚇🚊🚉✈️🛫🛬🛩️💺🛰️🚀🛸🚁🛶⛵🚤🛥️🛳️⛴️🚢⚓⛽🚧🚦🚥🚏🗺️🗿🗽🗼🏰🏯🏟️🎡🎢🎠⛲⛱️🏖️🏝️🏜️🌋⛰️🏔️🗻🏕️⛺🏠🏡🏘️🏚️🏗️🏭🏢🏬🏣🏤🏥🏦🏨🏪🏫🏩💒🏛️⛪🕌🕍🛕🕋⛩️🛤️🛣️🗾🎑🏞️🌅🌄🌠🎇🎆🌇🌆🏙️🌃🌌🌉🌁"],
  ["objects", "Objects", svg('<path d="M9 17h6M9.5 20h5M12 3.5a6 6 0 0 0-3.6 10.8c.5.4.6.9.6 1.5V17h6v-1.2c0-.6.2-1.1.6-1.5A6 6 0 0 0 12 3.5z"/>'),
    "⌚📱💻⌨️🖥️🖨️🖱️🕹️💽💾💿📷📸📹🎥📞☎️📟📠📺📻🎙️🧭⏱️⏲️⏰🕰️⌛⏳📡🔋🔌💡🔦🕯️🧯🛢️💸💵💴💶💷💰💳💎⚖️🧰🔧🔨⚒️🛠️⛏️🔩⚙️🧱⛓️🧲💣🧨🪓🔪🗡️⚔️🛡️⚰️🏺🔮📿🧿💈⚗️🔭🔬🕳️🩹🩺💊💉🩸🧬🦠🧪🌡️🧹🧺🧻🚽🚿🛁🧼🧽🧴🛎️🔑🗝️🚪🪑🛋️🛏️🧸🖼️🛍️🛒🎁🎈🎏🎀🎊🎉🎎🏮🎐🧧✉️📩📨📧💌📥📤📦🏷️📪📫📬📭📮📯📜📃📄📑🧾📊📈📉🗒️🗓️📆📅🗑️📇🗃️🗳️🗄️📋📁📂🗂️🗞️📰📓📔📒📕📗📘📙📚📖🔖🧷🔗📎🖇️📐📏🧮📌📍✂️🖊️🖋️✒️🖌️🖍️📝✏️🔍🔎🔏🔐🔒🔓"],
  ["symbols", "Symbols", svg('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'),
    "❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟☮️✝️☪️🕉️☸️✡️🔯☯️☦️🛐⛎♈♉♊♋♌♍♎♏♐♑♒♓🆔⚛️☢️☣️📴📳✴️🆚💮🅰️🅱️🆎🆑🅾️🆘❌⭕🛑⛔📛🚫💯💢♨️🚷🚯🚳🚱🔞📵🚭❗❕❓❔‼️⁉️🔅🔆〽️⚠️🚸🔱⚜️🔰♻️✅💹❇️✳️❎🌐💠Ⓜ️🌀💤🏧🚾♿🅿️🛂🛃🛄🛅🚹🚺🚼🚻🚮🎦📶🔣ℹ️🔤🔡🔠🆖🆗🆙🆒🆕🆓🔟🔢⏏️▶️⏸️⏯️⏹️⏺️⏭️⏮️⏩⏪⏫⏬◀️🔼🔽➡️⬅️⬆️⬇️↗️↘️↙️↖️↕️↔️↪️↩️⤴️⤵️🔀🔁🔂🔄🔃🎵🎶➕➖➗✖️♾️💲💱™️©️®️〰️➰➿🔚🔙🔛🔝🔜✔️☑️🔘🔴🟠🟡🟢🔵🟣⚫⚪🟤🔺🔻🔸🔹🔶🔷🔳🔲▪️▫️◾◽◼️◻️🟥🟧🟨🟩🟦🟪⬛⬜🟫🔈🔇🔉🔊🔔🔕📣📢💬💭🗯️♠️♣️♥️♦️🃏🎴🀄🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛"],
  ["flags", "Flags", svg('<path d="M5.5 21V4M5.5 4.5h13l-3 4 3 4h-13"/>'),
    "🏁🚩🎌🏴🏳️🏳️‍🌈🏴‍☠️🇺🇸🇨🇦🇲🇽🇧🇷🇦🇷🇬🇧🇮🇪🇫🇷🇩🇪🇮🇹🇪🇸🇵🇹🇳🇱🇧🇪🇨🇭🇦🇹🇸🇪🇳🇴🇩🇰🇫🇮🇵🇱🇺🇦🇷🇺🇹🇷🇬🇷🇮🇱🇸🇦🇦🇪🇮🇳🇨🇳🇯🇵🇰🇷🇭🇰🇸🇬🇹🇼🇹🇭🇻🇳🇮🇩🇵🇭🇲🇾🇦🇺🇳🇿🇿🇦🇳🇬🇪🇬🇰🇪🇨🇱🇨🇴🇵🇪🇪🇺🇺🇳"],
].map(([id, label, icon, list]) => ({ id, label, icon, list: split(list) }));
const RECENT_ICON = svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>');

// Stickers: trading badges of our own design (TradingView's sticker artwork is its own).
export const STICKERS = [
  ["buy", "BUY", "#089981"], ["sell", "SELL", "#f23645"], ["long", "LONG", "#089981"], ["short", "SHORT", "#f23645"],
  ["tp", "TP", "#089981"], ["sl", "SL", "#f23645"], ["hodl", "HODL", "#7e57c2"], ["moon", "TO THE MOON", "#7e57c2"],
  ["bullish", "BULLISH", "#089981"], ["bearish", "BEARISH", "#f23645"], ["breakout", "BREAKOUT", "#2962ff"], ["breakdown", "BREAKDOWN", "#ff9800"],
  ["support", "SUPPORT", "#00897b"], ["resistance", "RESISTANCE", "#e65100"], ["entry", "ENTRY", "#2962ff"], ["exit", "EXIT", "#5d606b"],
  ["fomo", "FOMO", "#ff9800"], ["rekt", "REKT", "#c62828"], ["wagmi", "WAGMI", "#1e88e5"], ["dyor", "DYOR", "#546e7a"],
].map(([id, text, color]) => ({ id, text, color }));
export const STICKER_BY_ID = Object.fromEntries(STICKERS.map((s) => [s.id, s]));

// Line icons on a 24 by 24 grid (stroked), or a character for currency signs.
export const ICONS = [
  ["arrow-up", "M12 20V4M5 11l7-7 7 7"], ["arrow-down", "M12 4v16M5 13l7 7 7-7"], ["arrow-right", "M4 12h16M13 5l7 7-7 7"], ["arrow-left", "M20 12H4M11 5l-7 7 7 7"],
  ["trend-up", "M3 17l6-6 4 4 8-8M15 7h6v6"], ["trend-down", "M3 7l6 6 4-4 8 8M15 17h6v-6"], ["check", "M4 12.5l5 5L20 6.5"], ["cross", "M6 6l12 12M18 6L6 18"],
  ["plus", "M12 5v14M5 12h14"], ["minus", "M5 12h14"], ["star", "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"],
  ["heart", "M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"], ["flag", "M5 21V4M5 4.5h12l-2.5 4 2.5 4H5"],
  ["bell", "M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 20.5h4"], ["bolt", "M13 3L5 13.5h6L10 21l8-10.5h-6z"],
  ["target", "M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0M12 2v4M12 18v4M2 12h4M18 12h4"],
  ["warning", "M12 3.5L21 19.5H3zM12 10v4.5M12 17v.5"], ["info", "M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 11v6M12 7.5v.5"],
  ["question", "M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6M12 17v.5"],
  ["lock", "M5 11h14v9.5H5zM8 11V7.5a4 4 0 0 1 8 0V11"], ["eye", "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0"],
  ["clock", "M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 7v5l3 2"], ["calendar", "M3.5 5h17v15.5h-17zM3.5 10h17M8 3v4M16 3v4"],
  ["chart", "M5 20v-8M11 20V5M17 20v-11M3 20.5h18"], ["fire", "M12 21c-4 0-6.5-2.6-6.5-6 0-3.5 2.5-5.5 3.5-8.5 1.5 1.5 2 3 2 4.5 1-1 2-2.5 2-4.5 3 2.5 5.5 5 5.5 8.5 0 3.4-2.5 6-6.5 6z"],
  ["pin", "M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11zM9.6 10a2.4 2.4 0 1 0 4.8 0 2.4 2.4 0 1 0-4.8 0"],
  ["thumbs-up", "M7 10v10H4V10zM7 10l4-7c1.5 0 2.5 1 2.2 2.5L12.5 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7"],
  ["thumbs-down", "M7 14V4H4v10zM7 14l4 7c1.5 0 2.5-1 2.2-2.5L12.5 15H19a2 2 0 0 0 2-2.3l-1.2-7A2 2 0 0 0 17.8 4H7"],
  ["trophy", "M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8 20.5h8M9.5 17h5"],
  ["dollar", null, "$"], ["euro", null, "€"], ["pound", null, "£"], ["yen", null, "¥"], ["bitcoin", null, "₿"], ["percent", null, "%"],
].map(([id, path, text]) => ({ id, path, text }));
export const ICON_BY_ID = Object.fromEntries(ICONS.map((i) => [i.id, i]));
const iconSvg = (i) => (i.path ? svg(`<path d="${i.path}"/>`) : `<span class="emo-char">${i.text}</span>`);

// The panel. pick(type, value) is called with "emoji" and the character, "sticker" and its id,
// or "icon" and its id.
export function emojiPanel(app, pick) {
  const el = document.createElement("div");
  el.className = "tool-menu emo-pop";
  let tab = "emojis";
  const recent = () => (app.settings.recentEmojis || []).slice(0, 18);
  const grid = (items, cls = "") => `<div class="emo-grid ${cls}">${items.join("")}</div>`;
  const draw = () => {
    let body = "";
    if (tab === "emojis") {
      const r = recent();
      body =
        `<div class="emo-cats">${r.length ? `<button data-cat="recent" title="Recently used">${RECENT_ICON}</button>` : ""}${EMOJI_CATEGORIES.map((c) => `<button data-cat="${c.id}" title="${c.label}">${c.icon}</button>`).join("")}</div><div class="emo-scroll">` +
        (r.length ? `<div class="emo-h" data-sec="recent">Recently used</div>${grid(r.map((e) => `<button data-emoji="${e}">${e}</button>`))}` : "") +
        EMOJI_CATEGORIES.map((c) => `<div class="emo-h" data-sec="${c.id}">${c.label}</div>${grid(c.list.map((e) => `<button data-emoji="${e}">${e}</button>`))}`).join("") +
        "</div>";
    } else if (tab === "stickers")
      body = `<div class="emo-scroll">${grid(STICKERS.map((s) => `<button data-sticker="${s.id}" title="${s.text}"><span class="emo-sticker" style="--c:${s.color}">${s.text}</span></button>`), "emo-stickers")}</div>`;
    else body = `<div class="emo-scroll">${grid(ICONS.map((i) => `<button data-icon="${i.id}" title="${i.id.replace("-", " ")}">${iconSvg(i)}</button>`), "emo-icons")}</div>`;
    el.innerHTML = `${body}<div class="emo-tabs">${[["emojis", "Emojis"], ["stickers", "Stickers"], ["icons", "Icons"]].map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>`;
    const scroll = el.querySelector(".emo-scroll"),
      cats = el.querySelectorAll(".emo-cats [data-cat]");
    const mark = () => {
      let cur = cats[0]?.dataset.cat;
      const secs = el.querySelectorAll("[data-sec]");
      for (const h of secs) if (h.offsetTop - scroll.offsetTop <= scroll.scrollTop + 4) cur = h.dataset.sec;
      // at the bottom, the last section counts even though its heading can't reach the top
      if (scroll.clientHeight && scroll.scrollHeight > scroll.clientHeight && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2 && secs.length) cur = secs[secs.length - 1].dataset.sec;
      cats.forEach((b) => b.classList.toggle("on", b.dataset.cat === cur));
    };
    if (cats.length) {
      scroll.onscroll = mark;
      mark();
      requestAnimationFrame(mark);
    }
  };
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.tab) {
      tab = b.dataset.tab;
      return draw();
    }
    if (b.dataset.cat) {
      const h = el.querySelector(`[data-sec="${b.dataset.cat}"]`), scroll = el.querySelector(".emo-scroll");
      if (h) scroll.scrollTop = h.offsetTop - scroll.offsetTop;
      return;
    }
    if (b.dataset.emoji) {
      const r = recent().filter((x) => x !== b.dataset.emoji);
      app.settings.recentEmojis = [b.dataset.emoji, ...r].slice(0, 18);
      return pick("emoji", b.dataset.emoji);
    }
    if (b.dataset.sticker) return pick("sticker", b.dataset.sticker);
    if (b.dataset.icon) return pick("icon", b.dataset.icon);
  };
  draw();
  return el;
}
