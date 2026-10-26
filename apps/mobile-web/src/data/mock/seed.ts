/**
 * Deterministic demo data for the InMemoryAdapter (e2e + demo mode).
 *
 * Eight seed cities, each with real-world venue coordinates and a mix of games
 * that exercises every UI state: starting soon (< 2h), live, full with a
 * waitlist, deposit, women-only with a hidden pin, private (invite link),
 * hosted by the demo user with pending requests, and a completed game.
 *
 * All times are relative to the adapter clock, so the data never goes stale.
 * Ids are readable strings (allowed by the contract) so e2e test ids are stable,
 * e.g. `map.pin.g-tlv-1`.
 */
import {
  DEFAULT_TRUST_CONFIG,
  SPORT_POSITIONS,
  type CurrencyCode,
  type CountryCode,
  type EpochMs,
  type Gender,
  type LatLng,
  type Locale,
  type Participant,
  type ParticipantStatus,
  type PositionId,
  type Profile,
  type ReliabilitySnapshot,
  type SportId,
  type Stars,
  type UserSport,
  type Venue,
} from '@st/domain';

import { approximateLocation, toIso } from './domain';
import type { MockGame, MockState, MockUser } from './state';

/** OTP accepted by the mock (docs/qa-strategy.md also lists 000000; both work). */
export const MOCK_OTP_CODES = ['123456', '000000'] as const;
/** Returning demo user: already onboarded, hosts games in Tel Aviv, has a disputable yellow card. */
export const DEMO_PHONE = '+972500000001';
export const DEMO_USER_ID = 'u-dana';

/** Dizengoff Square, Tel Aviv: the e2e geolocation and the default map centre. */
export const DEFAULT_CENTER: LatLng = { lat: 32.0779, lng: 34.7745 };

const QUARTER_HOUR = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

interface VenueSpec {
  key: string;
  name: string;
  at: LatLng;
  address: string;
  sports: SportId[];
  rating: [number, number] | null;
}

interface GameSpec {
  n: number;
  venue: string;
  sport: SportId;
  title: string;
  /** Hours from now (may be negative). */
  startH: number;
  durH: number;
  capacity: number;
  /** Approved players including the host. */
  approved: number;
  waitlist?: number;
  requested?: number;
  depositMinor?: number;
  womenOnly?: boolean;
  hide?: boolean;
  visibility?: 'public' | 'private';
  inviteToken?: string;
  /** Index into the city's people, or the demo user. */
  host: number | 'demo';
  /** Demo user participation in this game (when not host). */
  demo?: ParticipantStatus;
  teamCount?: number;
  status?: 'scheduled' | 'completed' | 'cancelled';
  notes?: string;
}

interface CitySpec {
  key: string;
  country: CountryCode;
  currency: CurrencyCode;
  locale: Locale;
  people: [name: string, gender: Gender][];
  venues: VenueSpec[];
  games: GameSpec[];
}

const CITIES: CitySpec[] = [
  {
    key: 'tlv',
    country: 'IL',
    currency: 'ILS',
    locale: 'he',
    people: [
      ['Yossi Cohen', 'male'],
      ['נועה ברק', 'female'],
      ['عمر حداد', 'male'],
      ['Maya Ben-David', 'female'],
      ['Lior Katz', 'male'],
      ['Shira Mizrahi', 'female'],
      ['أمير ناصر', 'male'],
      ['Tal Peretz', 'non_binary'],
      ['Eitan Golan', 'male'],
      ['Yael Friedman', 'female'],
      ['רון אלון', 'male'],
      ['Noam Shapiro', 'male'],
      ['Michal Avraham', 'female'],
      ['Daniel Rosen', 'male'],
    ],
    venues: [
      { key: 'yarkon', name: 'Park HaYarkon Fields', at: { lat: 32.0985, lng: 34.8095 }, address: 'Rokach Blvd, Tel Aviv', sports: ['football', 'running'], rating: [4.3, 38] },
      { key: 'gordon', name: 'Gordon Beach Courts', at: { lat: 32.0835, lng: 34.768 }, address: 'Gordon Beach, Tel Aviv', sports: ['volleyball'], rating: [4.6, 52] },
      { key: 'meir', name: 'Gan Meir Court', at: { lat: 32.0731, lng: 34.7737 }, address: 'King George St, Tel Aviv', sports: ['basketball'], rating: [3.9, 21] },
      { key: 'sportek', name: 'Sportek Padel', at: { lat: 32.1009, lng: 34.8066 }, address: 'Sportek, Yarkon Park, Tel Aviv', sports: ['padel', 'basketball'], rating: [4.1, 17] },
      { key: 'tennis', name: 'Tel Aviv Tennis Center', at: { lat: 32.1135, lng: 34.8067 }, address: 'Bnei Efraim Rd, Tel Aviv', sports: ['tennis'], rating: [4.4, 64] },
      { key: 'jaffa', name: 'Jaffa Port Pitch', at: { lat: 32.0533, lng: 34.752 }, address: 'Jaffa Port, Tel Aviv-Yafo', sports: ['football'], rating: [3.6, 9] },
      { key: 'clore', name: 'Charles Clore Park', at: { lat: 32.061, lng: 34.7609 }, address: 'Charles Clore Park, Tel Aviv', sports: ['running', 'football'], rating: null },
      { key: 'rabin', name: 'Rabin Square Court', at: { lat: 32.0809, lng: 34.7806 }, address: 'Rabin Square, Tel Aviv', sports: ['basketball', 'volleyball'], rating: null },
    ],
    games: [
      { n: 0, venue: 'yarkon', sport: 'football', title: 'Friday Morning Football', startH: -50, durH: 1.5, capacity: 10, approved: 10, host: 0, demo: 'approved', status: 'completed' },
      { n: 1, venue: 'yarkon', sport: 'football', title: 'Sunset 5v5 at Yarkon', startH: 1, durH: 1.5, capacity: 10, approved: 6, host: 0, demo: 'approved' },
      { n: 2, venue: 'gordon', sport: 'volleyball', title: 'Beach Volley Open Play', startH: -0.5, durH: 1.5, capacity: 8, approved: 8, waitlist: 2, host: 1 },
      { n: 3, venue: 'meir', sport: 'basketball', title: 'Gan Meir Pickup 3x3', startH: 3, durH: 1.5, capacity: 9, approved: 4, depositMinor: 2000, host: 2 },
      { n: 4, venue: 'sportek', sport: 'padel', title: 'Women’s Padel Doubles', startH: 24, durH: 1.5, capacity: 4, approved: 2, womenOnly: true, hide: true, host: 3, teamCount: 2 },
      { n: 5, venue: 'clore', sport: 'running', title: 'Sunrise 10K Run', startH: 40, durH: 1, capacity: 12, approved: 3, visibility: 'private', inviteToken: 'tlv-sunrise-run', host: 'demo', teamCount: 1 },
      { n: 6, venue: 'jaffa', sport: 'football', title: 'Jaffa Port 7v7', startH: 26, durH: 1.5, capacity: 14, approved: 9, requested: 2, host: 'demo' },
      { n: 7, venue: 'tennis', sport: 'tennis', title: 'Singles Hit & Rally', startH: 5, durH: 1, capacity: 2, approved: 1, host: 4, teamCount: 2 },
      { n: 8, venue: 'rabin', sport: 'basketball', title: 'Rabin Square Run', startH: 50, durH: 2, capacity: 10, approved: 5, host: 6 },
    ],
  },
  {
    key: 'lon',
    country: 'GB',
    currency: 'GBP',
    locale: 'en',
    people: [
      ['James Carter', 'male'],
      ['Priya Shah', 'female'],
      ['Tom O’Brien', 'male'],
      ['Grace Okafor', 'female'],
      ['Oliver Hughes', 'male'],
      ['Aisha Rahman', 'female'],
      ['Harry Wilson', 'male'],
      ['Chloe Evans', 'female'],
      ['Ben Taylor', 'male'],
      ['Sam Patel', 'non_binary'],
    ],
    venues: [
      { key: 'hyde', name: 'Hyde Park Pitches', at: { lat: 51.5073, lng: -0.1657 }, address: 'Hyde Park, London W2', sports: ['football', 'running'], rating: [4.2, 77] },
      { key: 'regents', name: 'Regent’s Park Tennis Centre', at: { lat: 51.5313, lng: -0.157 }, address: 'York Bridge, London NW1', sports: ['tennis'], rating: [4.5, 41] },
      { key: 'westway', name: 'Westway Sports Centre', at: { lat: 51.5203, lng: -0.2126 }, address: '1 Crowthorne Rd, London W10', sports: ['basketball', 'football'], rating: [4.0, 33] },
      { key: 'battersea', name: 'Battersea Park Track', at: { lat: 51.4791, lng: -0.1566 }, address: 'Battersea Park, London SW11', sports: ['running'], rating: null },
    ],
    games: [
      { n: 1, venue: 'hyde', sport: 'football', title: 'Hyde Park Sunday League', startH: 20, durH: 1.5, capacity: 12, approved: 8, host: 0 },
      { n: 2, venue: 'regents', sport: 'tennis', title: 'Doubles at Regent’s Park', startH: 6, durH: 1.5, capacity: 4, approved: 3, depositMinor: 500, host: 1 },
      { n: 3, venue: 'westway', sport: 'basketball', title: 'Westway Full Court', startH: 30, durH: 2, capacity: 10, approved: 10, waitlist: 1, host: 2 },
    ],
  },
  {
    key: 'mad',
    country: 'ES',
    currency: 'EUR',
    locale: 'es',
    people: [
      ['Lucía García', 'female'],
      ['Javier Romero', 'male'],
      ['Carmen López', 'female'],
      ['Diego Fernández', 'male'],
      ['Marta Sánchez', 'female'],
      ['Pablo Ruiz', 'male'],
      ['Elena Navarro', 'female'],
      ['Álvaro Torres', 'male'],
    ],
    venues: [
      { key: 'retiro', name: 'Parque del Retiro', at: { lat: 40.4153, lng: -3.6844 }, address: 'Plaza de la Independencia, Madrid', sports: ['running', 'padel'], rating: [4.7, 120] },
      { key: 'campo', name: 'Casa de Campo Fútbol', at: { lat: 40.4189, lng: -3.7476 }, address: 'Casa de Campo, Madrid', sports: ['football'], rating: [3.8, 25] },
      { key: 'chopera', name: 'Polideportivo La Chopera', at: { lat: 40.4096, lng: -3.6821 }, address: 'Paseo de Fernán Núñez, Madrid', sports: ['basketball', 'padel'], rating: [4.0, 14] },
    ],
    games: [
      { n: 1, venue: 'chopera', sport: 'padel', title: 'Pádel Intermedio', startH: 4, durH: 1.5, capacity: 4, approved: 3, host: 0, teamCount: 2 },
      { n: 2, venue: 'campo', sport: 'football', title: 'Fútbol 7 Casa de Campo', startH: 28, durH: 1.5, capacity: 14, approved: 7, depositMinor: 300, host: 1 },
      { n: 3, venue: 'retiro', sport: 'running', title: 'Vuelta al Retiro', startH: 15, durH: 1, capacity: 20, approved: 6, host: 2, teamCount: 1 },
    ],
  },
  {
    key: 'sao',
    country: 'BR',
    currency: 'BRL',
    locale: 'pt',
    people: [
      ['João Silva', 'male'],
      ['Ana Souza', 'female'],
      ['Pedro Oliveira', 'male'],
      ['Beatriz Lima', 'female'],
      ['Lucas Pereira', 'male'],
      ['Mariana Costa', 'female'],
      ['Rafael Almeida', 'male'],
      ['Gabriel Rocha', 'male'],
    ],
    venues: [
      { key: 'ibira', name: 'Parque Ibirapuera', at: { lat: -23.5874, lng: -46.6576 }, address: 'Av. Pedro Álvares Cabral, São Paulo', sports: ['football', 'running'], rating: [4.6, 210] },
      { key: 'villa', name: 'Parque Villa-Lobos', at: { lat: -23.5465, lng: -46.7228 }, address: 'Av. Prof. Fonseca Rodrigues, São Paulo', sports: ['basketball', 'volleyball'], rating: [4.2, 48] },
    ],
    games: [
      { n: 1, venue: 'ibira', sport: 'football', title: 'Pelada no Ibirapuera', startH: 2, durH: 1.5, capacity: 12, approved: 9, host: 0 },
      { n: 2, venue: 'villa', sport: 'volleyball', title: 'Vôlei de Domingo', startH: 45, durH: 2, capacity: 12, approved: 5, host: 1 },
    ],
  },
  {
    key: 'tyo',
    country: 'JP',
    currency: 'JPY',
    locale: 'ja',
    people: [
      ['佐藤 陽翔', 'male'],
      ['Yui Tanaka', 'female'],
      ['鈴木 蓮', 'male'],
      ['Sakura Ito', 'female'],
      ['高橋 湊', 'male'],
      ['Hina Watanabe', 'female'],
      ['Kenji Yamamoto', 'male'],
      ['Aoi Nakamura', 'female'],
    ],
    venues: [
      { key: 'yoyogi', name: 'Yoyogi Park Courts', at: { lat: 35.6717, lng: 139.6949 }, address: '2-1 Yoyogikamizonocho, Shibuya', sports: ['running', 'basketball'], rating: [4.3, 66] },
      { key: 'komazawa', name: 'Komazawa Olympic Park', at: { lat: 35.6255, lng: 139.6608 }, address: '1-1 Komazawakoen, Setagaya', sports: ['football', 'tennis'], rating: [4.5, 39] },
      { key: 'ariake', name: 'Ariake Tennis Forest', at: { lat: 35.6385, lng: 139.7894 }, address: '2-2-22 Ariake, Koto', sports: ['tennis'], rating: [4.8, 90] },
    ],
    games: [
      { n: 1, venue: 'yoyogi', sport: 'basketball', title: 'Yoyogi 3on3', startH: 8, durH: 1.5, capacity: 6, approved: 4, host: 0, teamCount: 2 },
      { n: 2, venue: 'komazawa', sport: 'football', title: 'Komazawa Futsal Night', startH: 32, durH: 1.5, capacity: 10, approved: 6, depositMinor: 1000, host: 1 },
      { n: 3, venue: 'ariake', sport: 'tennis', title: 'Ariake Morning Rally', startH: 18, durH: 1, capacity: 2, approved: 2, waitlist: 1, host: 2, teamCount: 2 },
    ],
  },
  {
    key: 'nyc',
    country: 'US',
    currency: 'USD',
    locale: 'en',
    people: [
      ['Marcus Johnson', 'male'],
      ['Sofia Rossi', 'female'],
      ['王伟', 'male'],
      ['Jasmine Brooks', 'female'],
      ['Carlos Mendez', 'male'],
      ['Emily Chen', 'female'],
      ['Darnell Washington', 'male'],
      ['Olivia Kim', 'female'],
      ['Ethan Miller', 'male'],
      ['Zoe Martinez', 'female'],
      ['陳美玲', 'female'],
    ],
    venues: [
      { key: 'lawn', name: 'Central Park Great Lawn', at: { lat: 40.7812, lng: -73.9665 }, address: 'Central Park, New York, NY', sports: ['football', 'running'], rating: [4.5, 140] },
      { key: 'rucker', name: 'Rucker Park', at: { lat: 40.8297, lng: -73.9365 }, address: '155th St & Frederick Douglass Blvd, NY', sports: ['basketball'], rating: [4.9, 310] },
      { key: 'pier2', name: 'Pier 2 Brooklyn Bridge Park', at: { lat: 40.699, lng: -73.999 }, address: '150 Furman St, Brooklyn, NY', sports: ['basketball', 'volleyball'], rating: [4.4, 88] },
    ],
    games: [
      { n: 1, venue: 'rucker', sport: 'basketball', title: 'Rucker Park Runs', startH: 1.5, durH: 2, capacity: 10, approved: 10, waitlist: 3, host: 0 },
      { n: 2, venue: 'pier2', sport: 'volleyball', title: 'Pier 2 Volleyball', startH: 22, durH: 2, capacity: 12, approved: 7, host: 1 },
      { n: 3, venue: 'lawn', sport: 'football', title: 'Great Lawn Soccer', startH: 27, durH: 1.5, capacity: 16, approved: 11, depositMinor: 1000, host: 2 },
    ],
  },
  {
    key: 'bom',
    country: 'IN',
    currency: 'INR',
    locale: 'hi',
    people: [
      ['अर्जुन मेहता', 'male'],
      ['Ananya Iyer', 'female'],
      ['Rohan Kapoor', 'male'],
      ['प्रिया शर्मा', 'female'],
      ['Vikram Rao', 'male'],
      ['Sneha Desai', 'female'],
      ['Karan Malhotra', 'male'],
    ],
    venues: [
      { key: 'shivaji', name: 'Shivaji Park', at: { lat: 19.0269, lng: 72.8381 }, address: 'Dadar West, Mumbai', sports: ['football', 'running'], rating: [4.4, 95] },
      { key: 'oval', name: 'Oval Maidan', at: { lat: 18.9294, lng: 72.8297 }, address: 'Churchgate, Mumbai', sports: ['football'], rating: [4.1, 60] },
      { key: 'nsci', name: 'NSCI Dome Courts', at: { lat: 18.975, lng: 72.8148 }, address: 'Worli, Mumbai', sports: ['basketball'], rating: [4.0, 18] },
    ],
    games: [
      { n: 1, venue: 'shivaji', sport: 'football', title: 'Shivaji Park Evening Kickabout', startH: 9, durH: 1.5, capacity: 14, approved: 8, host: 0 },
      { n: 2, venue: 'nsci', sport: 'basketball', title: 'Worli Hoops', startH: 34, durH: 1.5, capacity: 10, approved: 4, host: 1 },
    ],
  },
  {
    key: 'par',
    country: 'FR',
    currency: 'EUR',
    locale: 'fr',
    people: [
      ['Camille Dubois', 'female'],
      ['Hugo Martin', 'male'],
      ['Сергей Иванов', 'male'],
      ['Lena Müller', 'female'],
      ['Louis Bernard', 'male'],
      ['Inès Moreau', 'female'],
      ['Giulia Ferrari', 'female'],
      ['Mathis Laurent', 'male'],
    ],
    venues: [
      { key: 'mars', name: 'Champ de Mars', at: { lat: 48.8556, lng: 2.2986 }, address: '2 Allée Adrienne Lecouvreur, Paris', sports: ['running', 'football'], rating: [4.5, 130] },
      { key: 'lux', name: 'Tennis du Luxembourg', at: { lat: 48.8462, lng: 2.3371 }, address: 'Jardin du Luxembourg, Paris', sports: ['tennis'], rating: [4.2, 44] },
      { key: 'duperre', name: 'Terrain Duperré', at: { lat: 48.8826, lng: 2.3368 }, address: '22 Rue Duperré, Paris', sports: ['basketball'], rating: [4.7, 71] },
    ],
    games: [
      { n: 1, venue: 'duperre', sport: 'basketball', title: 'Pigalle Duperré Pickup', startH: 7, durH: 1.5, capacity: 10, approved: 6, host: 1 },
      { n: 2, venue: 'mars', sport: 'running', title: 'Footing au Champ de Mars', startH: 16, durH: 1, capacity: 15, approved: 4, host: 0, teamCount: 1 },
      { n: 3, venue: 'lux', sport: 'tennis', title: 'Double mixte au Luxembourg', startH: 44, durH: 1.5, capacity: 4, approved: 2, womenOnly: false, depositMinor: 500, host: 3, teamCount: 2 },
    ],
  },
];

/** Reliability snapshot per the PRD formula (prior 3, late cancel weight 0.5). */
function reliability(verified: number, games: number, lateCancels: number, noShows: number, hasCard: boolean, now: EpochMs): ReliabilitySnapshot {
  const c = DEFAULT_TRUST_CONFIG;
  const commitments = games + lateCancels * c.reliabilityLateCancelWeight;
  if (commitments < c.reliabilityMinGames) {
    return { score: null, status: 'new', verifiedCount: verified, commitmentCount: commitments, lateCancelCount: lateCancels, noShowCount: noShows, computedAt: toIso(now) };
  }
  const score = (verified + c.reliabilityPrior) / (commitments + c.reliabilityPrior);
  const status = score < c.reliabilityRedBelow ? 'red' : !hasCard && score >= c.reliabilityGreenMin ? 'green' : 'yellow';
  return { score, status, verifiedCount: verified, commitmentCount: commitments, lateCancelCount: lateCancels, noShowCount: noShows, computedAt: toIso(now) };
}

function emptyProfileFlags(): Pick<Profile, 'chatMutedUntil' | 'joinBannedUntil' | 'hostSuspendedUntil' | 'visibilityRestrictedUntil' | 'permanentlyBanned'> {
  return { chatMutedUntil: null, joinBannedUntil: null, hostSuspendedUntil: null, visibilityRestrictedUntil: null, permanentlyBanned: false };
}

function stars(n: number): Stars {
  return Math.max(1, Math.min(5, Math.round(n))) as Stars;
}

function sportEntry(userId: string, sport: SportId, skill: number, seed: number): UserSport {
  const positions = SPORT_POSITIONS[sport] as readonly PositionId[];
  const pos = positions.length ? [positions[seed % positions.length] as PositionId] : [];
  return {
    userId,
    sport,
    selfSkill: stars(skill),
    attributes: { speed: stars(skill + ((seed % 3) - 1)), control: stars(skill), overall: stars(skill) },
    positions: pos,
  } as UserSport;
}

/** Builds the full seeded state for `now`. Pure and deterministic. */
export function buildSeed(now: EpochMs): MockState {
  const base = Math.floor(now / QUARTER_HOUR) * QUARTER_HOUR;
  const at = (hours: number) => toIso(base + hours * HOUR);
  const state: MockState = {
    users: new Map(),
    venues: new Map(),
    games: new Map(),
    participants: new Map(),
    venueRatings: [],
    venueReports: [],
    sanctions: [],
    appeals: [],
    userReports: [],
    blocks: [],
    notifications: [],
    messages: [],
    translations: [],
    results: new Map(),
    hostRatings: [],
    payments: [],
    pushTokens: [],
    peerConfirmations: [],
    inviteAccess: new Set(),
    seq: 0,
  };

  const addUser = (u: MockUser) => state.users.set(u.id, u);

  // Returning demo user (Tel Aviv).
  addUser({
    id: DEMO_USER_ID,
    phone: DEMO_PHONE,
    createdAt: at(-24 * 200),
    privateData: { birthYear: 1994, birthMonth: 5, gender: 'female' },
    profile: {
      id: DEMO_USER_ID,
      displayName: 'Dana Levi',
      avatarUrl: null,
      bio: 'Midfielder, morning runner, always brings a pump.',
      locale: 'en',
      countryCode: 'IL',
      reliability: reliability(11, 12, 1, 0, true, now),
      verifiedHost: true,
      ...emptyProfileFlags(),
      createdAt: at(-24 * 200),
    },
    sports: [sportEntry(DEMO_USER_ID, 'football', 4, 2), sportEntry(DEMO_USER_ID, 'running', 3, 0)],
  });

  let personSeed = 0;
  for (const city of CITIES) {
    const people = city.people.map(([name, gender], i) => {
      const id = `u-${city.key}-${i}`;
      personSeed += 7;
      const games = (personSeed * 3) % 24;
      const late = personSeed % 11 === 0 ? 1 : 0;
      const noShow = personSeed % 13 === 0 ? 1 : 0;
      const verified = Math.max(0, games - noShow - (personSeed % 5 === 0 ? 1 : 0));
      const user: MockUser = {
        id,
        phone: null,
        createdAt: at(-24 * (30 + ((personSeed * 5) % 400))),
        privateData: { birthYear: 1980 + (personSeed % 25), birthMonth: 1 + (personSeed % 12), gender },
        profile: {
          id,
          displayName: name,
          avatarUrl: null,
          bio: null,
          locale: city.locale,
          countryCode: city.country,
          reliability: reliability(verified, games, late, noShow, late > 0, now),
          verifiedHost: i % 4 === 0,
          ...emptyProfileFlags(),
          createdAt: at(-24 * (30 + ((personSeed * 5) % 400))),
        },
        sports: [],
      };
      addUser(user);
      return user;
    });

    for (const v of city.venues) {
      const venue: Venue = {
        id: `v-${city.key}-${v.key}`,
        name: v.name,
        location: v.at,
        address: v.address,
        countryCode: city.country,
        sports: v.sports,
        status: 'active',
        ratingAvg: v.rating ? v.rating[0] : null,
        ratingCount: v.rating ? v.rating[1] : 0,
        createdBy: null,
        createdAt: at(-24 * 365),
      };
      state.venues.set(venue.id, venue);
    }

    for (const g of city.games) {
      const venue = state.venues.get(`v-${city.key}-${g.venue}`);
      if (!venue) throw new Error(`seed: unknown venue ${g.venue}`);
      const hostId = g.host === 'demo' ? DEMO_USER_ID : (people[g.host]?.id ?? DEMO_USER_ID);
      const id = `g-${city.key}-${g.n}`;
      const startsAt = at(g.startH);
      const game: MockGame = {
        id,
        hostId,
        sport: g.sport,
        title: g.title,
        notes: g.notes ?? null,
        visibility: g.visibility ?? 'public',
        venueId: venue.id,
        location: venue.location,
        approxLocation: approximateLocation(venue.location),
        hideExactLocation: g.hide ?? false,
        capacity: g.capacity,
        startsAt,
        endsAt: at(g.startH + g.durH),
        depositMinor: g.depositMinor ?? 0,
        currency: city.currency,
        depositForfeitTo: 'pot',
        womenOnly: g.womenOnly ?? false,
        status: g.status ?? 'scheduled',
        teamCount: g.teamCount ?? 2,
        inviteToken: g.inviteToken ?? `inv-${id}`,
        createdAt: at(g.startH - 72),
        qrSecret: `qr-secret-${id}`,
      };
      state.games.set(id, game);

      const eligible = people.filter((p) => p.id !== hostId && (!game.womenOnly || p.privateData?.gender === 'female'));
      const add = (userId: string, status: ParticipantStatus, rank: number | null, idx: number) => {
        const verified = game.status === 'completed' && status === 'approved';
        const p: Participant = {
          gameId: id,
          userId,
          status,
          attendance: verified ? 'verified' : 'unknown',
          team: null,
          position: null,
          waitlistRank: rank,
          lateCancel: false,
          checkInMethod: verified ? 'gps' : null,
          checkedInAt: verified ? toIso(Date.parse(startsAt) - 5 * 60 * 1000) : null,
          requestedAt: at(g.startH - 48 + idx * 0.25),
          decidedAt: status === 'requested' ? null : at(g.startH - 40 + idx * 0.25),
          cancelledAt: null,
        };
        state.participants.set(`${id}|${userId}`, p);
      };
      add(hostId, 'approved', null, 0);
      let cursor = 0;
      const take = () => eligible[cursor++ % Math.max(1, eligible.length)];
      const demoTakesSeat = g.demo === 'approved' && hostId !== DEMO_USER_ID;
      if (demoTakesSeat) add(DEMO_USER_ID, 'approved', null, 1);
      const others = g.approved - 1 - (demoTakesSeat ? 1 : 0);
      for (let i = 0; i < others && cursor < eligible.length; i++) {
        const u = take();
        if (u) add(u.id, 'approved', null, i + 2);
      }
      for (let i = 0; i < (g.waitlist ?? 0) && cursor < eligible.length; i++) {
        const u = take();
        if (u) add(u.id, 'waitlisted', i + 1, 20 + i);
      }
      for (let i = 0; i < (g.requested ?? 0) && cursor < eligible.length; i++) {
        const u = take();
        if (u) add(u.id, 'requested', null, 30 + i);
      }

      // Give players a sport entry for this game's sport (skills for squad balancing).
      for (const p of state.participants.values()) {
        if (p.gameId !== id) continue;
        const u = state.users.get(p.userId);
        if (u && !u.sports.some((s) => s.sport === g.sport)) {
          u.sports.push(sportEntry(u.id, g.sport, 2 + ((u.id.length + g.n) % 4), u.id.length + g.n));
        }
      }
      if (game.status === 'completed') {
        state.results.set(id, { gameId: id, teamScores: [4, 3], submittedBy: hostId, submittedAt: game.endsAt });
      }
    }
  }

  // Demo user's late cancel on a past game produced a disputable yellow card (sanctions screen demo).
  const issued = base - 20 * HOUR;
  state.sanctions.push({
    id: 'sanction-demo-1',
    userId: DEMO_USER_ID,
    kind: 'yellow_card',
    reasonCode: 'late_cancel',
    statementKey: 'sanctions.reason.late_cancel',
    statementParams: { date: toIso(issued - 4 * HOUR), gameTitle: 'Thursday Night Hoops', hours: DEFAULT_TRUST_CONFIG.lateCancelWindowHours, appealPath: 'dispute' },
    startsAt: toIso(issued),
    expiresAt: toIso(issued + DEFAULT_TRUST_CONFIG.yellowCardLifetimeDays * 24 * HOUR),
    disputeUntil: toIso(issued + DEFAULT_TRUST_CONFIG.disputeWindowHours * HOUR),
    status: 'active',
    gameId: null,
    causedBy: [],
    dedupeKey: 'late_cancel:g-tlv-old:u-dana',
    createdAt: toIso(issued),
    decidedBy: 'system',
  });
  state.notifications.push(
    {
      id: 'n-demo-1',
      userId: DEMO_USER_ID,
      kind: 'sanction_issued',
      params: {},
      gameId: null,
      sanctionId: 'sanction-demo-1',
      readAt: null,
      createdAt: toIso(issued),
    },
    {
      id: 'n-demo-2',
      userId: DEMO_USER_ID,
      kind: 'join_requested',
      params: { name: 'Michal Avraham', gameTitle: 'Jaffa Port 7v7' },
      gameId: 'g-tlv-6',
      sanctionId: null,
      readAt: null,
      createdAt: at(-2),
    },
  );
  return state;
}
