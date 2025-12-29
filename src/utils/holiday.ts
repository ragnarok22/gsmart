import chalk from "chalk";

/**
 * Display a festive holiday message with snow in light blue
 */
export function showHolidayMessage(): void {
  const cyan = chalk.cyan;

  const snow = "  *  ❄  *  ✦  *  ❅  *  ✦  *  ❄  *  ✦  *  ❅  *  ";
  const message = "        🎄  H A P P Y   H O L I D A Y S  🎄        ";

  console.log();
  console.log(cyan(snow));
  console.log(cyan(message));
  console.log(cyan(snow));
  console.log();
}
