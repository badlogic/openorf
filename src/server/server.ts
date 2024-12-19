import bodyParser from "body-parser";
import * as chokidar from "chokidar";
import compression from "compression";
import cors from "cors";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { scrapeTv } from "../data/scrape.js";
import { SimplifiedTVItem } from "../data/tv.js";
import { Request, Response } from "express";
import chalk from "chalk";

const port = process.env.PORT ?? 3333;

(async () => {
    const app = express();
    app.set("json spaces", 2);
    app.use(cors());
    app.use(compression());
    app.use(bodyParser.urlencoded({ extended: true }));

    app.get("/api/hello", (req, res) => {
        res.json({ message: "Hello world" });
    });

    app.get("/api/news", async (req: Request, res: Response) => {
        try {
            const start = (req.query.start as string) || new Date().toISOString().split("T")[0];
            const end = (req.query.end as string) || start;
            const subs = (req.query.subs as string) == "true";

            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(start) || !dateRegex.test(end)) {
                res.status(400).json({
                    error: "Invalid date format. Use YYYY-MM-DD",
                });
                return;
            }

            const startDate = new Date(start + "T00:00:00Z");
            const endDate = new Date(end + "T00:00:00Z");

            if (startDate.toString() === "Invalid Date" || endDate.toString() === "Invalid Date") {
                res.status(400).json({
                    error: "Invalid date values",
                });
                return;
            }

            if (startDate > endDate) {
                res.status(400).json({
                    error: "Start date must be before or equal to end date",
                });
                return;
            }

            const dates: string[] = [];
            const currentDate = new Date(startDate);
            while (currentDate <= endDate) {
                dates.push(currentDate.toISOString().split("T")[0]);
                currentDate.setDate(currentDate.getDate() + 1);
            }

            const allItems: SimplifiedTVItem[] = [];
            for (const date of dates) {
                try {
                    const fileName = `simple-schedule-${date}.json`;
                    const filePath = path.join("/data", fileName);
                    if (fs.existsSync(filePath)) {
                        const fileContent = fs.readFileSync(filePath, "utf-8");
                        const items = JSON.parse(fileContent) as SimplifiedTVItem[];
                        if (!subs) {
                            items.forEach((tv) => tv.segments?.forEach((s) => (s.subtitles = undefined)));
                        }
                        allItems.push(...items);
                    }
                } catch (error) {
                    console.error(`Error reading file for date ${date}:`, error);
                    // Continue with next file even if one fails
                }
            }

            // Filter for ZIB & Info items and sort by date
            const filteredItems = allItems
                .filter((item) => item.genre === "ZIB & Info")
                .sort((a, b) => {
                    const dateA = new Date(a.date);
                    const dateB = new Date(b.date);
                    return dateB.getTime() - dateA.getTime();
                });

            res.json(filteredItems);
        } catch (error) {
            console.error("Error processing request:", error);
            res.status(500).json({
                error: "Internal server error",
            });
        }
    });

    const server = http.createServer(app);
    server.listen(port, async () => {
        console.log(`App listening on port ${port}`);
    });

    setupLiveReload(server);
    scrapeLoop();
})();

function setupLiveReload(server: http.Server) {
    const wss = new WebSocketServer({ server });
    const clients: Set<WebSocket> = new Set();
    wss.on("connection", (ws: WebSocket) => {
        clients.add(ws);
        ws.on("close", () => {
            clients.delete(ws);
        });
    });

    chokidar.watch("html/", { ignored: /(^|[\/\\])\../, ignoreInitial: true }).on("all", (event, path) => {
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(`File changed: ${path}`);
            }
        });
    });
    console.log("Initialized live-reload");
}

async function checkAndScrapeHistorical() {
    const dates = [];
    for (let i = 0; i < 30; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        dates.push(date);
    }

    for (const date of dates) {
        console.log(chalk.magenta(`Scraping potentially new data for ${date.toISOString().split("T")[0]}`));
        await scrapeTv(date);
    }
}

async function scrapeLoop() {
    try {
        // On first run, check and scrape historical data
        await checkAndScrapeHistorical();

        // Start the continuous scraping loop for today
        async function continuousScrape() {
            try {
                const today = new Date();
                const yesterday = new Date();
                yesterday.setDate(today.getDate() - 1);
                await scrapeTv(yesterday);
                await scrapeTv(today);
            } catch (error) {
                console.error(chalk.red("Error in scrape loop:"), error);
            }
            setTimeout(continuousScrape, 1000 * 60 * 15);
        }

        continuousScrape();
    } catch (error) {
        console.error("Error in initial historical scrape:", error);
        // If historical scrape fails, still start the continuous scraping
        scrapeLoop();
    }
}
