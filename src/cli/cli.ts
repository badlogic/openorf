import chalk from "chalk";
import * as fs from "fs";
import { sleep } from "../utils/utils";
import { fetchTVSchedule, OriginalTVItem, processEpisode, SimplifiedTVItem, transformTVItem } from "../data/tv";
import { scrapeTv } from "../data/scrape";

async function main() {
    // Create data directory if it doesn't exist
    if (!fs.existsSync("data")) {
        fs.mkdirSync("data");
    }

    const startDate = new Date("2024-12-13");
    const currentDate = new Date();
    let date = startDate;

    while (date <= currentDate) {
        await scrapeTv(date);
        date.setDate(date.getDate() + 1);
        await sleep(200);
    }
}

main().catch((error) => {
    console.error(chalk.red("Script failed:", error));
    process.exit(1);
});
