import chalk from "chalk";

type Holiday =
  | "new-year"
  | "valentines"
  | "easter"
  | "halloween"
  | "thanksgiving"
  | "christmas"
  | "new-year-eve";

const getEasterDate = (year: number): { month: number; day: number } => {
  // Anonymous Gregorian algorithm
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return { month, day };
};

const getThanksgivingDate = (year: number): { month: number; day: number } => {
  const november = 10;
  const firstOfMonth = new Date(year, november, 1);
  const dayOfWeek = firstOfMonth.getDay();
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
  const firstThursday = 1 + daysUntilThursday;
  const fourthThursday = firstThursday + 21;

  return { month: november + 1, day: fourthThursday };
};

export const getHolidayForDate = (date: Date): Holiday | null => {
  const month = date.getMonth() + 1; // 1-12
  const day = date.getDate();
  const year = date.getFullYear();
  const easter = getEasterDate(year);
  const thanksgiving = getThanksgivingDate(year);

  if (month === 1 && day === 1) {
    return "new-year";
  }

  if (month === 2 && day === 14) {
    return "valentines";
  }

  if (month === easter.month && day === easter.day) {
    return "easter";
  }

  if (month === 10 && day === 31) {
    return "halloween";
  }

  if (month === thanksgiving.month && day === thanksgiving.day) {
    return "thanksgiving";
  }

  if (month === 12 && (day === 24 || day === 25)) {
    return "christmas";
  }

  if (month === 12 && day === 31) {
    return "new-year-eve";
  }

  return null;
};

/**
 * Display a Christmas/Winter holiday message with snow
 */
export function showChristmasMessage(): void {
  const cyan = chalk.cyan;

  const snow = "  *  ❄  *  ✦  *  ❅  *  ✦  *  ❄  *  ✦  *  ❅  *  ";
  const message = "        🎄  H A P P Y   H O L I D A Y S  🎄        ";

  console.log();
  console.log(cyan(snow));
  console.log(cyan(message));
  console.log(cyan(snow));
  console.log();
}

/**
 * Display a New Year message with fireworks
 */
export function showNewYearMessage(): void {
  const yellow = chalk.yellow;
  const magenta = chalk.magenta;

  const fireworks = "  ✨  🎆  ✨  🎇  ✨  🎆  ✨  🎇  ✨  🎆  ✨  ";
  const message = "        🎉  H A P P Y   N E W   Y E A R  🎉        ";

  console.log();
  console.log(yellow(fireworks));
  console.log(magenta(message));
  console.log(yellow(fireworks));
  console.log();
}

/**
 * Display a Valentine's Day message with hearts
 */
export function showValentinesMessage(): void {
  const red = chalk.red;
  const pink = chalk.hex("#FF69B4");

  const hearts = "  💕  💖  💕  💝  💕  💖  💕  💝  💕  💖  💕  ";
  const message = "      💘  H A P P Y   V A L E N T I N E S  💘      ";

  console.log();
  console.log(red(hearts));
  console.log(pink(message));
  console.log(red(hearts));
  console.log();
}

/**
 * Display an Easter message with spring theme
 */
export function showEasterMessage(): void {
  const green = chalk.green;
  const yellow = chalk.yellow;

  const spring = "  🌸  🐰  🌷  🥚  🌸  🐰  🌷  🥚  🌸  🐰  🌷  ";
  const message = "          🐣  H A P P Y   E A S T E R  🐣          ";

  console.log();
  console.log(yellow(spring));
  console.log(green(message));
  console.log(yellow(spring));
  console.log();
}

/**
 * Display a Halloween message with spooky theme
 */
export function showHalloweenMessage(): void {
  const orange = chalk.hex("#FF8C00");
  const purple = chalk.hex("#9370DB");

  const spooky = "  👻  🎃  🦇  🕷️   👻  🎃  🦇  🕷️   👻  🎃  🦇  ";
  const message = "        🎃  H A P P Y   H A L L O W E E N  🎃      ";

  console.log();
  console.log(orange(spooky));
  console.log(purple(message));
  console.log(orange(spooky));
  console.log();
}

/**
 * Display a Thanksgiving message
 */
export function showThanksgivingMessage(): void {
  const brown = chalk.hex("#8B4513");
  const orange = chalk.hex("#FF8C00");

  const autumn = "  🍂  🦃  🍁  🌽  🍂  🦃  🍁  🌽  🍂  🦃  🍁  ";
  const message = "      🦃  H A P P Y   T H A N K S G I V I N G  🦃  ";

  console.log();
  console.log(orange(autumn));
  console.log(brown(message));
  console.log(orange(autumn));
  console.log();
}

/**
 * Display a Summer message
 */
export function showSummerMessage(): void {
  const yellow = chalk.yellow;
  const blue = chalk.cyan;

  const summer = "  ☀️  🌊  🏖️   🍉  ☀️  🌊  🏖️   🍉  ☀️  🌊  🏖️   ";
  const message = "        🌞  E N J O Y   S U M M E R  🌞          ";

  console.log();
  console.log(yellow(summer));
  console.log(blue(message));
  console.log(yellow(summer));
  console.log();
}

/**
 * Display a Spring message
 */
export function showSpringMessage(): void {
  const green = chalk.green;
  const pink = chalk.hex("#FF69B4");

  const spring = "  🌼  🌻  🌺  🦋  🌼  🌻  🌺  🦋  🌼  🌻  🌺  ";
  const message = "        🌷  E N J O Y   S P R I N G  🌷          ";

  console.log();
  console.log(pink(spring));
  console.log(green(message));
  console.log(pink(spring));
  console.log();
}

/**
 * Determine which holiday message to show based on current date
 * Only shows messages on specific special days
 */
export function showHolidayMessage(): void {
  const holiday = getHolidayForDate(new Date());

  switch (holiday) {
    case "new-year":
      showNewYearMessage();
      return;
    case "valentines":
      showValentinesMessage();
      return;
    case "easter":
      showEasterMessage();
      return;
    case "halloween":
      showHalloweenMessage();
      return;
    case "thanksgiving":
      showThanksgivingMessage();
      return;
    case "christmas":
      showChristmasMessage();
      return;
    case "new-year-eve":
      showNewYearMessage();
      return;
    default:
      return;
  }
}
