// vercel.json (create this file in the root directory)
{
  "version": 2,
  "builds": [
    {
      "src": "index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/index.js"
    }
  ]
}

// index.js
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();

// Middleware to parse JSON bodies (optional, for future enhancements)
app.use(express.json());

async function scrapeSearchResults(searchTerm) {
    const url = `https://slanimeclub.co/search/${encodeURIComponent(searchTerm)}/`;
    try {
        const response = await axios.get(url, { timeout: 5000 }); // 5-second timeout
        const html = response.data;
        const $ = cheerio.load(html);
        const results = [];

        $(".result-item article").each((index, element) => {
            const name = $(element).find(".title a").text().trim() || "N/A";
            const link = $(element).find(".thumbnail a").attr("href") || "N/A";
            const type = $(element).find(".thumbnail span").text().trim() || "N/A";

            if (type === "TV" || type === "Movie") {
                results.push({ name, link });
            }
        });

        return results;
    } catch (error) {
        console.error(`Error fetching search results: ${error.message}`);
        return [];
    }
}

async function scrapeMovie(detailUrl) {
    try {
        const response = await axios.get(detailUrl, { timeout: 5000 });
        const html = response.data;
        const $ = cheerio.load(html);

        const title = $("h1").text().trim() || "N/A";
        const imdbRating = $("#repimdb strong").text().trim() || "N/A";
        const thumbnail = $(".sheader .poster img").attr("src") || "N/A";
        const downloadLink = await scrapeDownloadOrWatchOnlineLink(detailUrl);

        return { title, imdbRating, thumbnail, downloadLink };
    } catch (error) {
        console.error(`Error scraping movie ${detailUrl}: ${error.message}`);
        return null;
    }
}

async function scrapeTVSeries(detailUrl) {
    try {
        const response = await axios.get(detailUrl, { timeout: 5000 });
        const html = response.data;
        const $ = cheerio.load(html);

        const title = $("h1").text().trim() || "N/A";
        const thumbnail = $(".sheader .poster img").attr("src") || "N/A";
        const episodes = [];

        $("#seasons .episodios li").each((i, el) => {
            const episodeLink = $(el).find(".episodiotitle a").attr("href") || "N/A";
            const episodeName = $(el).find(".episodiotitle a").text().trim() || "N/A";
            episodes.push({
                episodeNumber: i + 1,
                name: episodeName,
                url: episodeLink,
            });
        });

        const episodeDetails = await Promise.all(
            episodes.map(async (ep) => {
                const downloadLink = await scrapeDownloadOrWatchOnlineLink(ep.url);
                return {
                    episodeNumber: ep.episodeNumber,
                    name: ep.name,
                    downloadLink,
                };
            }),
        );

        return { title, thumbnail, episodes: episodeDetails };
    } catch (error) {
        console.error(`Error scraping TV series ${detailUrl}: ${error.message}`);
        return null;
    }
}

async function scrapeDownloadOrWatchOnlineLink(detailUrl) {
    try {
        const response = await axios.get(detailUrl, { timeout: 5000 });
        const html = response.data;
        const $ = cheerio.load(html);

        // Try to get watch online link
        let link = $('#videos .links_table tbody tr td a[href*="links/"]').attr("href");
        if (!link) {
            // Fallback to download link
            link = $("#download .links_table tbody tr td a").attr("href");
        }

        if (link) {
            const fullLink = `${link}`;
            return await scrapeDownloadPage(fullLink);
        }
        return null;
    } catch (error) {
        console.error(`Error scraping download/watch online link from ${detailUrl}: ${error.message}`);
        return null;
    }
}

async function scrapeDownloadPage(downloadPageUrl) {
    try {
        const response = await axios.get(downloadPageUrl, { timeout: 5000 });
        const html = response.data;
        const $ = cheerio.load(html);

        const driveLink = $("#link").attr("href");
        if (driveLink) {
            return driveLink;
        }
        return null;
    } catch (error) {
        console.error(`Error scraping download page ${downloadPageUrl}: ${error.message}`);
        return null;
    }
}

async function convertToDownloadLink(driveLink) {
    if (!driveLink || !driveLink.includes("drive.google.com")) return driveLink;

    const fileIdMatch = driveLink.match(/\/d\/([a-zA-Z0-9_-]+)/) || driveLink.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (!fileIdMatch || !fileIdMatch[1]) return driveLink;

    const fileId = fileIdMatch[1];
    const initialUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    try {
        const directResponse = await axios.get(initialUrl, {
            maxRedirects: 5,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            },
        });

        return directResponse.request.res.responseUrl || initialUrl;
    } catch (error) {
        console.error(`Error converting to download link for ${driveLink}: ${error.message}`);

        const openUrl = `https://drive.google.com/open?id=${fileId}&authuser=0`;
        try {
            const response = await axios.get(openUrl, {
                maxRedirects: 0,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                },
            });

            if (response.status === 302) {
                const warningUrl = response.headers.location;
                const warningResponse = await axios.get(warningUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                    },
                });

                const $ = cheerio.load(warningResponse.data);
                const form = $("#download-form");
                if (form) {
                    const action = form.attr("action");
                    const params = {};
                    form.find('input[type="hidden"]').each((i, el) => {
                        params[$(el).attr("name")] = $(el).attr("value");
                    });

                    const queryString = new URLSearchParams(params).toString();
                    return `${action}?${queryString}`;
                }
            }
        } catch (innerError) {
            console.error(`Error handling virus scan warning for ${driveLink}: ${innerError.message}`);
            return initialUrl;
        }

        return initialUrl;
    }
}

// API Routes
app.get("/api/search", async (req, res) => {
    const { search } = req.query;
    if (!search) {
        return res.status(400).json({ error: "Search term is required" });
    }

    const results = await scrapeSearchResults(search);
    return res.json({ results });
});

app.get("/api/details", async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: "URL is required" });
    }

    if (url.includes("/movies/")) {
        const movieDetails = await scrapeMovie(url);
        if (movieDetails) {
            const downloadLink = movieDetails.downloadLink
                ? await convertToDownloadLink(movieDetails.downloadLink)
                : "N/A";
            return res.json({ movie: { ...movieDetails, downloadLink } });
        } else {
            return res.status(500).json({ error: "Failed to scrape movie details" });
        }
    } else if (url.includes("/tvshows/")) {
        const seriesDetails = await scrapeTVSeries(url);
        if (seriesDetails) {
            const updatedEpisodes = await Promise.all(
                seriesDetails.episodes.map(async (ep) => {
                    const downloadLink = ep.downloadLink
                        ? await convertToDownloadLink(ep.downloadLink)
                        : "N/A";
                    return { ...ep, downloadLink };
                }),
            );
            return res.json({
                tvSeries: { ...seriesDetails, episodes: updatedEpisodes },
            });
        } else {
            return res.status(500).json({ error: "Failed to scrape TV series details" });
        }
    } else if (url.includes("/episodes/")) {
        const episodeDetails = await scrapeMovie(url); // Note: Should be scrapeTVSeries for episodes
        if (episodeDetails) {
            const downloadLink = episodeDetails.downloadLink
                ? await convertToDownloadLink(episodeDetails.downloadLink)
                : "N/A";
            return res.json({ episode: { ...episodeDetails, downloadLink } });
        } else {
            return res.status(500).json({ error: "Failed to scrape episode details" });
        }
    } else {
        return res
            .status(400)
            .json({
                error: "Invalid URL: Must be a movie, TV series, or episode URL",
            });
    }
});

app.get("/", (req, res) => {
    res.send(
        "Anime Scraper API is running. Use /api/search?search=[term] or /api/details?url=[url]",
    );
});

// Export the app for Vercel
module.exports = app;
