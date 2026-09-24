// Each download gets a random anime character's name, e.g. Totoro.zip.
// Only the zip is renamed: the MochiPlayer sketch folder inside keeps its
// name, since Arduino needs the folder and the .ino file to match.

const NAMES = [
  'Totoro', 'Pikachu', 'Naruto', 'Goku', 'Vegeta', 'Luffy', 'Zoro', 'Kiki', 'Jiji', 'Chihiro',
  'Haku', 'Ponyo', 'Nausicaa', 'Howl', 'Calcifer', 'Sophie', 'Asuka', 'Shinji', 'Spike', 'Edward',
  'Alphonse', 'Levi', 'Mikasa', 'Eren', 'Tanjiro', 'Nezuko', 'Gojo', 'Anya', 'Loid', 'Yor',
  'Frieren', 'Himmel', 'Saitama', 'Genos', 'Killua', 'Gon', 'Kakashi', 'Hinata', 'Usagi', 'Ryuk',
  'Denji', 'Pochita', 'Makima', 'Bocchi', 'Nobita', 'Sailor_Moon', 'Doraemon', 'Astro_Boy', 'Mob', 'Rem',
];

let last = null;

/** A random name like "Totoro.zip", never the same twice in a row. */
export function randomZipName() {
  let name;
  do {
    name = NAMES[Math.floor(Math.random() * NAMES.length)];
  } while (name === last);
  last = name;
  return `${name}.zip`;
}
