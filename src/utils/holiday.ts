import chalk from "chalk";

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
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();

  // New Year's Day (January 1)
  if (month === 1 && day === 1) {
    showNewYearMessage();
    return;
  }

  // Valentine's Day (February 14)
  if (month === 2 && day === 14) {
    showValentinesMessage();
    return;
  }

  // Easter Sunday (varies, typically early April - using April 20 as example)
  // Note: Easter dates change yearly, this is a simplified check
  if (month === 4 && day === 20) {
    showEasterMessage();
    return;
  }

  // Independence Day (July 4 - US)
  // Uncomment if you want to add this
  // if (month === 7 && day === 4) {
  //   showSummerMessage();
  //   return;
  // }

  // Halloween (October 31)
  if (month === 10 && day === 31) {
    showHalloweenMessage();
    return;
  }

  // Thanksgiving (4th Thursday of November - using November 28 as example)
  // Note: Thanksgiving dates change yearly, this is a simplified check
  if (month === 11 && day === 28) {
    showThanksgivingMessage();
    return;
  }

  // Christmas Eve (December 24)
  if (month === 12 && day === 24) {
    showChristmasMessage();
    return;
  }

  // Christmas Day (December 25)
  if (month === 12 && day === 25) {
    showChristmasMessage();
    return;
  }

  // New Year's Eve (December 31)
  if (month === 12 && day === 31) {
    showNewYearMessage();
    return;
  }

  // Default: No message for regular days
}
