import { runWeather } from './weather.tool';

function mockFetchResponses(geoBody: unknown, forecastBody: unknown): jest.Mock {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ json: async () => geoBody })
    .mockResolvedValueOnce({ json: async () => forecastBody });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('runWeather', () => {
  it('returns a formatted summary for a known city', async () => {
    mockFetchResponses(
      [{ lat: '24.86', lon: '67.01', display_name: 'Karachi, Sindh, Pakistan' }],
      { current: { temperature_2m: 32.5, wind_speed_10m: 14, weather_code: 1 } },
    );

    const result = await runWeather('Karachi');

    expect(result).toBe('Karachi, Sindh, Pakistan: 32.5°C, Mainly clear, wind 14 km/h.');
  });

  it('returns an error when the city cannot be found', async () => {
    mockFetchResponses([], {});

    const result = await runWeather('Nowhereville');

    expect(result).toBe('Error: could not find a location named "Nowhereville".');
  });

  it('returns an error when no location is provided', async () => {
    const result = await runWeather('   ');

    expect(result).toBe('Error: no location was provided.');
  });

  it('returns an error when the network request fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const result = await runWeather('Karachi');

    expect(result).toBe('Error: could not fetch weather for "Karachi".');
  });
});
