// Small curated set with keywords for search. Enough for page icons without shipping a big dataset.
export const EMOJI: [string, string][] = [
  ["📄", "page document file"], ["📝", "note memo write"], ["📓", "notebook"], ["📚", "books study school"], ["📖", "book read"], ["🗂️", "folder database files"], ["📁", "folder"], ["🗒️", "notepad list"],
  ["✅", "done check task todo"], ["☑️", "checkbox"], ["📌", "pin"], ["📍", "location"], ["🎯", "goal target"], ["🚀", "rocket launch project"], ["💡", "idea light bulb"], ["🔥", "fire hot"],
  ["⭐", "star favorite"], ["🌟", "sparkle"], ["✨", "magic sparkles ai"], ["❤️", "heart love"], ["🧠", "brain mind think"], ["🤖", "robot ai agent"], ["💻", "laptop computer code"], ["⌨️", "keyboard"],
  ["🖥️", "desktop monitor"], ["📱", "phone iphone"], ["🌐", "web globe internet"], ["⚙️", "settings gear"], ["🔧", "tool wrench"], ["🛠️", "tools build"], ["🔒", "lock private"], ["🔑", "key"],
  ["📊", "chart data stats"], ["📈", "growth chart up"], ["📉", "chart down"], ["🧮", "math abacus calculate"], ["➗", "divide math"], ["➕", "plus add"], ["📐", "ruler geometry math"], ["📏", "ruler"],
  ["🔬", "science microscope"], ["🧪", "chemistry test tube"], ["⚗️", "chemistry"], ["🌍", "earth world geography"], ["🗺️", "map"], ["🧭", "compass"], ["⏰", "alarm clock time"], ["📅", "calendar date"],
  ["🗓️", "calendar schedule"], ["⌛", "hourglass"], ["🎓", "graduation school"], ["🏫", "school"], ["✏️", "pencil write"], ["🖊️", "pen"], ["🖍️", "crayon"], ["🎨", "art paint design"],
  ["🎮", "game video gaming"], ["🕹️", "joystick game"], ["⛏️", "pickaxe minecraft mine"], ["🧱", "brick lego minecraft"], ["🟩", "green block minecraft"], ["🐷", "pig minecraft"], ["🧟", "zombie minecraft"], ["💎", "diamond gem minecraft"],
  ["⚡", "lightning pikachu pokemon electric"], ["🔴", "red pokeball pokemon"], ["⚪", "white circle"], ["🐉", "dragon"], ["🐲", "dragon"], ["🌀", "swirl"], ["🌊", "wave ocean sea seaglass"], ["🏖️", "beach"],
  ["🐚", "shell sea"], ["🐙", "octopus"], ["🐬", "dolphin"], ["🐟", "fish"], ["🌴", "palm"], ["🌿", "plant leaf"], ["🌱", "seedling grow"], ["🌳", "tree"],
  ["🪐", "planet star wars space"], ["🌌", "galaxy space star wars"], ["🛸", "ufo"], ["👽", "alien"], ["⚔️", "swords battle jedi"], ["🗡️", "sword saber"], ["🛡️", "shield"],
  ["👑", "crown king"], ["🏆", "trophy win"], ["🥇", "gold medal"], ["🎁", "gift"], ["🎉", "party celebrate"], ["🎵", "music"], ["🎧", "headphones"], ["🎬", "movie film"],
  ["📷", "camera photo"], ["🖼️", "picture image"], ["✉️", "email mail"], ["📬", "inbox mailbox"], ["📞", "phone call"], ["💬", "chat message"], ["🗨️", "speech"], ["🔔", "bell notify"],
  ["🏠", "home house"], ["🏢", "office building"], ["🛒", "shopping cart"], ["💰", "money"], ["💳", "card pay"], ["🍎", "apple food"], ["🍕", "pizza food"], ["☕", "coffee"],
  ["🏃", "run exercise"], ["🏋️", "gym"], ["🧘", "yoga calm"], ["😀", "smile happy"], ["😎", "cool"], ["🤔", "think"], ["😴", "sleep"], ["📦", "box package"],
  ["🧩", "puzzle"], ["♟️", "chess"], ["🎲", "dice"], ["🃏", "card joker"], ["🔖", "bookmark"], ["🏷️", "tag label"], ["📎", "clip attach"], ["🔗", "link"],
];
// Guard against accidental duplicates (they're used as React keys).
{ const seen = new Set<string>(); for (let i = EMOJI.length - 1; i >= 0; i--) { if (seen.has(EMOJI[i][0])) EMOJI.splice(i, 1); else seen.add(EMOJI[i][0]); } }
