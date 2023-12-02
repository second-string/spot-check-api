import express from "express";
import {Router} from "express";
import fs from 'fs';
import moment from "moment";
import fetch from "node-fetch";
import path from "path";

import {
    buildSwellString,
    buildTideString,
    degreesToDirStr,
    getCurrentTideHeight,
    getTideExtremes,
    getWeather,
    MONTHS,
    rendersDir,
    roundToMaxSingleDecimal,
    SpotCheckRevision
} from "./helpers";
import * as render   from "./render";
import * as surfline from "./surfline";

const fsPromises      = fs.promises;
const versionFilePath = "./fw_versions";

export default function(): express.Router {
    const router = Router();

    router.get("/health",
               (req: express.Request, res: express.Response) => { return res.send("surviving not thriving"); });

    router.get("/tides", async (req: express.Request, res: express.Response) => {
        const days = req.query.days as unknown as number;
        throw new Error("hi mom!");

        let rawTides: SurflineTidesResponse[] = [];
        if (req.query.spot_id) {
            const spotId = req.query.spot_id as unknown as string;
            rawTides     = await                            surfline.getTidesBySpotId(spotId, days);
        } else if (req.query.spot_name) {
            const spotName = req.query.spot_name as unknown as string;
            rawTides       = await                                surfline.getTidesBySpotName(spotName, days);
        }

        const tideExtremes: {[key: number]: SurflineTidesResponse[]} = getTideExtremes(rawTides);
        const tideStrings                                            = Object.keys(tideExtremes)
                                .map((x: string) => buildTideString(tideExtremes[Number(x)], SpotCheckRevision.Rev2));
        let responseObj: TidesResponse = {errorMessage : undefined, data : tideStrings};

        return res.json(responseObj);
    });

    router.get("/swell", async (req: express.Request, res: express.Response) => {
        const days = req.query.days as unknown as number;

        let rawSwell: SurflineWaveResponse[] = [];
        if (req.query.spot_id) {
            const spotId = req.query.spot_id as unknown as string;
            rawSwell     = await                            surfline.getWavesBySpotId(spotId, days);
        } else if (req.query.spot_name) {
            const spotName = req.query.spot_name as unknown as string;
            rawSwell       = await                                surfline.getWavesBySpotName(spotName, days);
        }

        const parsedSwell: {[key: number]: SurflineWaveResponse[]} =
            rawSwell.sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
                .reduce((aggregate: {[key: number]: SurflineWaveResponse[]}, element: SurflineWaveResponse) => {
                    // We don't care about anything between 9:01pm and 2:59am
                    // This only drops the midnight entry for 6-hour intervals
                    // but can be more effective on smaller interval ranges
                    const date = moment((element.timestamp as number) * 1000);
                    if (date.hour() < 3 || date.hour() > 21) {
                        return aggregate;
                    }

                    // Overwrite epoch timestamp with parsed date
                    element.timestamp = date;
                    const day         = date.date() as number;
                    if (aggregate[day]) {
                        aggregate[day].push(element);
                    } else {
                        aggregate[day] = [ element ];
                    }
                    return aggregate;
                }, {});

        const swellStrings = Object.keys(parsedSwell)
                                 .map((x: string) => buildSwellString(parsedSwell[Number(x)], SpotCheckRevision.Rev2));
        const responseObj: TidesResponse = {errorMessage : undefined, data : swellStrings};

        return res.json(responseObj);
    });

    router.get("/conditions", async (req: express.Request, res: express.Response) => {
        const latitude: number  = req.query.lat as unknown as number;
        const longitude: number = req.query.lon as unknown as number;
        const spotId: string    = req.query.spot_id as unknown as string;

        if (!latitude || !longitude) {
            console.log(`Received weather request with missing lat or lon (${req.query.lat} - ${req.query.lon})`);
            res.status(400).send();
            return;
        }

        if (!spotId || spotId === "") {
            return -99;
        }

        const tidesRes                                     = await surfline.getTidesBySpotId(spotId, 1);
        let                    currentTideObj: CurrentTide = getCurrentTideHeight(tidesRes);
        const weatherResponse: TidesResponse               = await getWeather(latitude, longitude);
        if (weatherResponse.errorMessage) {
            return res.status(500).json(weatherResponse);
        }

        const windDirStr: string = degreesToDirStr(weatherResponse.data.wind.deg);

        // We don't want A) our embedded code to have to deal with floating point in the case of tide height
        // and B) to show the user fractional temp degrees/mph, so cast tide as string and round temp and
        // wind_speed and
        const responseObj: TidesResponse = {
            errorMessage : undefined,
            data : {
                temp : Math.round(weatherResponse.data.temperature),
                wind_speed : Math.round(weatherResponse.data.wind.speed),
                wind_dir : windDirStr,
                tide_height : currentTideObj.height.toString(),
            }
        };

        return res.json(responseObj);
    });

    router.post("/ota/version_info", async (req: express.Request, res: express.Response) => {
        console.log(req.body);
        if (!req.body || !req.body.current_version) {
            // Unproccessable Entity
            console.error(
                "Received POST for version info with either no body or no 'current_version' key sending 422. Body:");
            console.error(req.body);
            return res.status(422).send();
        }

        const reqBody: VersionRequest = req.body as VersionRequest;
        let                                      versionFile;
        try {
            versionFile = await fsPromises.readFile(`${versionFilePath}/current_version.txt`);
        } catch (e) {
            console.error("Error opening current_version text file: ");
            console.error(e);
            return res.status(503);
        }

        const versionStr: string = versionFile.toString().trim();
        if (reqBody.current_version > versionStr) {
            console.log(
                `Received version check POST with FW current version > version stored in server version.txt. received: ${
                    reqBody.current_version}, server: ${versionStr}`)
        }
        const retVal: VersionResponse = {
            server_version : versionStr,
            needs_update : reqBody.current_version != undefined && reqBody.current_version < versionStr,
        };

        return res.json(retVal);
    });

    router.get("/ota/get_binary", async (req: express.Request, res: express.Response) => {
        let binaryPath = undefined;
        if (req.query.version) {
            const queryStr: string = req.query.version as string;
            // TODO :: regex validate this (or check from known available versions)

            const requestedVersionNumberStrs: string[] = queryStr.split(".");
            const requestedBinaryPath = `${versionFilePath}/spot-check-firmware-${requestedVersionNumberStrs[0]}-${
                requestedVersionNumberStrs[1]}-${requestedVersionNumberStrs[2]}.bin`;

            try {
                await fsPromises.access(requestedBinaryPath);
                binaryPath = requestedBinaryPath;
            } catch (e) {
                console.error(`Received request for binary version ${queryStr} but don't have matching filepath ${
                    requestedBinaryPath}, falling back to current version`);
                binaryPath = undefined;
            }
        }

        // If they didn'trequest a specific version or if we didn't have the binary they requested
        if (!binaryPath) {
            // Get most current version first
            let versionFile;
            try {
                versionFile = await fsPromises.readFile(`${versionFilePath}/current_version.txt`);
            } catch (e) {
                console.error("Error opening current_version text file: ");
                console.error(e);
                return res.status(503).send();
            }

            const currentVersionNumberStrs: string[] = versionFile.toString().trim().split(".");
            const currentBinaryPath = `${versionFilePath}/spot-check-firmware-${currentVersionNumberStrs[0]}-${
                currentVersionNumberStrs[1]}-${currentVersionNumberStrs[2]}.bin`;

            try {
                // if this fails, somethings messed up on the server side and we're missing a binary
                await fsPromises.access(currentBinaryPath);
                binaryPath = currentBinaryPath;
            } catch (e) {
                // TODO :: try to find the most recent good binary we have access to here
                console.error(`Received ota binary request but don't have matching binary filepath ${
                    currentBinaryPath} in current_version file, unrecoverable.`);
                return res.status(503).send();
            }
        }

        res.sendFile(binaryPath, {root : `${__dirname}/..`});
    });

    /*
     * Render a 2 pixels-per-byte, black and white raw array of data and return it to caller
     * Test curl (spot_id only thing used for spot, lat/lon don't matter):
     */
    // clang-format off
    // curl -k -X GET "https://localhost:9443/swell_chart?lat=XX&lon=YY&spot_id=5842041f4e65fad6a770882b&width=WW&h=HH&device_id=ff-ff-ff-ff-ff-ff" > /dev/null
    // clang-format on
    router.get("/tides_chart", async (req: express.Request, res: express.Response) => {
        let deviceId: string = req.query.device_id as unknown as string;
        if (!deviceId) {
            console.log(`Received tides_chart req with no device id, denying`);
            res.status(403).send("Missing device_id")
            return;
        }

        let latitude: number  = req.query.lat as unknown as number;
        let longitude: number = req.query.lon as unknown as number;
        let spotId: string    = req.query.spot_id as unknown as string;
        let width: number     = req.query.width as unknown as number;
        let height: number    = req.query.height as unknown as number;
        if (!latitude || !longitude || !spotId) {
            console.log(`Received tides_chart req with missing lat, lon, or spot id (${req.query.lat} - ${
                req.query.lon} - ${spotId})`);
            res.status(400).send("Missing request data");
            return;
        }

        if (!width) {
            width = 700;
        }

        if (!height) {
            height = 200;
        }

        // Current tide height from surfline
        const rawTides = await surfline.getTidesBySpotId(spotId, 1);

        // Switch timestamps received from server to moment objects. Epoch is timezone/offset-agnostic, so instantiate
        // as UTC. Use utcOffset func to shift date to user's utc offset to correctly interpret day of year so we know
        // which raw tide objects to filter before burning into chart.
        const tidesWithResponseOffset = rawTides.map(
            x => ({...x, timestamp : moment.utc(((x.timestamp as number) * 1000)).utcOffset(x.utcOffset)}));
        const responseDayOfYear: number = tidesWithResponseOffset[0].timestamp.dayOfYear();
        const tidesSingleDay = tidesWithResponseOffset.filter(x => x.timestamp.dayOfYear() == responseDayOfYear);

        const xValues: number[] = tidesSingleDay.map(x => x.timestamp.hour() + x.timestamp.minute() / 60);
        const yValues: number[] = tidesSingleDay.map(x => x.height);
        const tick0: number     = tidesSingleDay[0].timestamp.hour();
        const xAxisTitle: string =
            tidesSingleDay[0].timestamp.format("dddd MM/DD");  // Friday 12/22, non-localized but eh

        const tideChartFilename = `tide_chart_${deviceId}.jpeg`;
        let   generatedRawFilepath: string;
        try {
            generatedRawFilepath =
                await render.renderTideChart(tideChartFilename, xValues, yValues, tick0, xAxisTitle, width, height);
        } catch (e) {
            return res.status(500).send("Failed to generate tide chart");
        }

        return res.download(generatedRawFilepath, tideChartFilename, (err) => {
            if (err) {
                console.error(`Error in response download for swellchart: ${err}`);
            }

            fs.unlink(path.join(rendersDir, tideChartFilename), (err) => {
                if (err) {
                    console.error(`Error erasing image ${tideChartFilename} after sending, non-fatal`)
                }
            });
            fs.unlink(generatedRawFilepath, (err) => {
                if (err) {
                    console.error(`Error erasing image ${tideChartFilename} after sending, non-fatal`)
                }
            });
        });
    });

    /*
     * Render a 2 pixels-per-byte, black and white raw array of data and return it to caller
     * Test curl (spot_id only thing used for spot, lat/lon don't matter):
     */
    // clang-format off
    // curl -k -X GET "https://localhost:9443/swell_chart?lat=XX&lon=YY&spot_id=5842041f4e65fad6a770882b&width=WW&h=HH&device_id=ff-ff-ff-ff-ff-ff" > /dev/null
    // clang-format on
    router.get("/swell_chart", async (req: express.Request, res: express.Response) => {
        let deviceId: string = req.query.device_id as unknown as string;
        if (!deviceId) {
            console.log(`Received tides_chart req with no device id, denying`);
            res.status(403).send("Missing device_id")
            return;
        }

        let latitude: number  = req.query.lat as unknown as number;
        let longitude: number = req.query.lon as unknown as number;
        let spotId: string    = req.query.spot_id as unknown as string;
        let width: number     = req.query.width as unknown as number;
        let height: number    = req.query.height as unknown as number;
        if (!latitude || !longitude || !spotId) {
            console.log(`Received swell_chart req with missing lat, lon, or spot id (${req.query.lat} - ${
                req.query.lon} - ${spotId})`);
            res.status(400).send("Missing request data");
            return;
        }

        if (!width) {
            width = 700;
        }

        if (!height) {
            height = 200;
        }

        // Surfline updated API to finally enforce premium limits with permissions, which means max days requestable
        // without an premium `accessToken` query param is 5
        const rawSwell: SurflineWaveResponse[] = await surfline.getWavesBySpotId(spotId, 5, 1);

        // Switch timestamps received from server to moment objects. Epoch is timezone/offset-agnostic, so instantiate
        // as UTC. Use utcOffset func to shift date to user's utc offset (returned in response, `x.utcOffset`) to
        // correctly interpret day of year so we know which raw tide objects to filter before burning into chart.
        const swellsWithResponseOffset = rawSwell.map(
            x => ({...x, timestamp : moment.utc(((x.timestamp as number) * 1000)).utcOffset(x.utcOffset)}));

        // Returns object with keys for every day of year receieved from api starting with today. Value is a
        // DailySwellValues object with pretty str and the overall max/min for the day
        const dailySwellMaxMins = swellsWithResponseOffset.reduce(
            (aggregate: {[key: number]: DailySwellValues}, element: SurflineWaveResponse) => {
                const currentDayMoment                                      = element.timestamp as moment.Moment;
                const                                      currentDayOfYear = currentDayMoment.dayOfYear();
                const                                      currentMax       = element.surf.max!;
                const                                      currentMin       = element.surf.min!;

                // If day of week isn't in aggregate yet, add it with max and mins. Otherwise only update max and min if
                // currentelement is greater/less than existing for day
                if (aggregate[currentDayOfYear]) {
                    const dayMax                    = aggregate[currentDayOfYear].max;
                    const dayMin                    = aggregate[currentDayOfYear].min;
                    aggregate[currentDayOfYear].max = (currentMax! > dayMax) ? currentMax : dayMax;
                    aggregate[currentDayOfYear].min = (currentMin! > dayMin) ? currentMin : dayMin;
                } else {
                    aggregate[currentDayOfYear] = {
                        dayString : currentDayMoment.format("ddd DD"),
                        max : element.surf.max!,
                        min : element.surf.min!,
                    };
                }

                return aggregate;
            },
            {});

        const xValues    = Object.values(dailySwellMaxMins).map(x => x.dayString);
        const yValuesMax = Object.values(dailySwellMaxMins).map(x => x.max);
        const yValuesMin = Object.values(dailySwellMaxMins).map(x => x.min);

        const swellChartFilename = `swell_chart_${deviceId}.jpeg`;
        let   generatedRawFilepath: string;
        try {
            generatedRawFilepath =
                await render.renderSwellChart(swellChartFilename, xValues, yValuesMax, yValuesMin, width, height);
        } catch (e) {
            return res.status(500).send("Failed to generate swell chart");
        }

        return res.download(generatedRawFilepath, swellChartFilename, (err) => {
            if (err) {
                console.error(`Error in response download for swellchart: ${err}`);
            }

            fs.unlink(path.join(rendersDir, swellChartFilename), (err) => {
                if (err) {
                    console.error(`Error erasing image ${swellChartFilename} after sending, non-fatal`)
                }
            });
            fs.unlink(generatedRawFilepath, (err) => {
                if (err) {
                    console.error(`Error erasing image ${swellChartFilename} after sending, non-fatal`)
                }
            });
        });
    });

    router.get("/test_error",
               async (req: express.Request,
                      res: express.Response,
                      next: express.NextFunction) => { throw new Error("test_error endpoint"); });

    return router;
}
