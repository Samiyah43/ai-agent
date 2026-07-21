import OpenAI from 'openai';

export const weatherToolDefinition: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description:
      'Gets the current weather (temperature, wind, conditions) for a city. Use this whenever the user asks about the weather.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'The city name, e.g. "Karachi" or "Lahore"',
        },
      },
      required: ['location'],
    },
  },
};

const WEATHER_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow fall',
  73: 'Moderate snow fall',
  75: 'Heavy snow fall',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
};

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
}

interface ForecastResult {
  current?: { temperature_2m: number; wind_speed_10m: number; weather_code: number };
}

// Nominatim (OpenStreetMap) has much broader coverage of small towns than Open-Meteo's
// own geocoder, which only knows populous places. Its usage policy requires a descriptive
// User-Agent instead of a browser-like one.
async function geocode(location: string): Promise<NominatimPlace | undefined> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1&accept-language=en`,
    { headers: { 'User-Agent': 'ai-agent-learning-project (weather tool)' } },
  );
  const results = (await response.json()) as NominatimPlace[];
  return results[0];
}

export async function runWeather(location: string): Promise<string> {
  if (!location.trim()) {
    return 'Error: no location was provided.';
  }

  try {
    const place = await geocode(location);

    if (!place) {
      return `Error: could not find a location named "${location}".`;
    }

    const forecastResponse = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,wind_speed_10m,weather_code`,
    );
    const forecastData = (await forecastResponse.json()) as ForecastResult;
    const current = forecastData.current;

    if (!current) {
      return `Error: weather data is unavailable for "${location}" right now.`;
    }

    const condition = WEATHER_DESCRIPTIONS[current.weather_code] ?? 'Unknown conditions';
    return `${place.display_name}: ${current.temperature_2m}°C, ${condition}, wind ${current.wind_speed_10m} km/h.`;
  } catch {
    return `Error: could not fetch weather for "${location}".`;
  }
}
