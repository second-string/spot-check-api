interface SpotCheckApiResponse {
    errorMessage?: string;
    data: any;
}

interface SurflineSurfObject {
    max?: number;
    min?: number;
    optimalScore?: number;
}

interface SurflineWaveResponse {
    timestamp: number|import("moment").Moment;
    utcOffset: number;
    swells: any[];
    surf: SurflineSurfObject;
}

interface SurflineTidesResponse {
    timestamp: number|import("moment").Moment;
    utcOffset: number;
    type: string;
    height: number;
}

// One of the two will be null depending on which URL is requested
interface SurflineBaseDataObject {
    wave?: SurflineWaveResponse[];
    tides?: SurflineTidesResponse[];
}

interface SurflineBaseApiResponse {
    associated: any;
    data: SurflineBaseDataObject
}

interface OpenWeatherMapWeatherObject {
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    pressure: number;
    humidity: number;
}

interface OpenWeatherMapResponse {
    coord: any;
    weather: any;
    base: string;
    main: OpenWeatherMapWeatherObject;
    visibility: number;
    wind: any;
    clouds: any;
    dt: string;
    sys: any;
    timezone: number;
    id: number;
    name: string;
    cod: number;
    message: string;  // Only sent in the case that 'cod' is an error code
}

interface Wind {
    speed: number;
    deg: number;
}

interface Weather {
    temperature: number;
    wind: Wind;
}

interface VersionRequest {
    current_version: string;
    device_id: string;
}

interface VersionResponse {
    server_version: string;
    needs_update: bool;
}

interface CurrentTide {
    height: number;
    rising: boolean;
}

interface DailySwellValues {
    dayString: string;
    max: number;
    min: number;
}
