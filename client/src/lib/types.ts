import type { ECONOMIES, Level, MARKER_KINDS, PLAYER_ROLES, SIDES } from './constants';

export type { Level };

export type Side = (typeof SIDES)[number];
export type Economy = (typeof ECONOMIES)[number];
export type MarkerKind = (typeof MARKER_KINDS)[number];
export type PlayerRole = (typeof PLAYER_ROLES)[number];

export interface Point { x: number; y: number }
export interface LineupImage { image_id: string; caption: string }
export interface Marker {
  id: string;
  kind: MarkerKind;
  x: number;
  y: number;
  level?: Level;
  user_id: number | null;
  // Player 1-5 in shared and imported tactics, until mapped to a roster player.
  slot?: number | null;
  // Note text uses `label`; size is its font size in board units.
  label: string;
  size?: number;
  images?: (LineupImage & { url?: string })[];
}
export interface Route { id: string; level?: Level; user_id: number | null; slot?: number | null; color: string; points: Point[] }
// Angle a player covers, anchored to their player marker.
export interface Hold { id: string; marker_id: string; angle: number; spread: number; length: number }
export interface Board { markers: Marker[]; routes: Route[]; holds?: Hold[] }

export interface Assignment {
  user_id: number | null;
  slot?: number | null;
  user_name?: string;
  instruction: string;
  utility: string;
  reference_url?: string | null;
  is_member?: boolean;
}

export interface Phase { name: string; notes: string; board: Board; assignments: Assignment[] }

export interface TacticFields {
  tactic_name: string;
  map: string;
  side: Side;
  economy: Economy;
  grenade: number;
  molly: number;
  flash: number;
  smoke: number;
}

export interface TacticDocument extends Omit<TacticFields, 'map' | 'side' | 'economy'> {
  tactic_id: number;
  team_id: number;
  map: string | null;
  side: Side | null;
  economy: string;
  revision: number;
  updated_at: string;
  imported_from_share_id?: number | null;
  phases: Phase[];
}

export interface TacticSummary {
  tactic_id: number;
  tactic_name: string;
  team_id: number;
  map: string | null;
  side: Side | null;
  economy: string;
  grenade: number;
  molly: number;
  flash: number;
  smoke: number;
  revision: number;
  updated_at: string;
  phase_count: number;
  share_id?: number | null;
  imported_from_share_id?: number | null;
}

export interface RosterEntry { user_id: number; user_name: string; player_role: PlayerRole | null }

export interface User { user_id: number; user_name: string; email: string }

export interface Membership {
  team_id: number;
  team_name: string;
  is_owner: boolean;
  is_igl: boolean;
  can_lead: boolean;
  can_control: boolean;
  player_role: PlayerRole | null;
}

export interface MeResponse {
  user: User | null;
  teams: Membership[];
  active_team: Membership | null;
  csrf_token: string;
}

export interface Member {
  user_id: number;
  user_name: string;
  avatar_url: string | null;
  is_igl: boolean;
  is_owner: boolean;
  can_lead: boolean;
  player_role: PlayerRole | null;
  joined_at: string;
}

export interface Team {
  team_id: number;
  team_name: string;
  owner: number;
  language: string | null;
  region: string | null;
  platform: string | null;
  skill_level: string | null;
  description: string | null;
  logo_url: string | null;
  is_recruiting: boolean;
  recruiting_leagues: string | null;
  roles_needed: PlayerRole[];
  recruiting_notes: string | null;
}

export interface RosterResponse {
  team: Team;
  members: Member[];
  viewer: { is_owner: boolean; is_igl: boolean; can_lead: boolean; can_control: boolean };
}

export interface Invite {
  invite_id: number;
  kind: 'link' | 'player';
  invitee_user_id: number | null;
  invitee_name?: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  max_uses: number | null;
  use_count: number;
  status: 'active' | 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked' | 'used_up';
}

export interface UserRef { user_id: number; user_name: string }

export interface GameSession {
  session_id: number;
  team_id: number;
  status: 'active' | 'ended';
  version: number;
  current_phase: number;
  phase_count: number;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  started_by: UserRef | null;
  ended_by: UserRef | null;
  tactic: TacticFields & { tactic_id: number; revision: number };
  phases: { index: number; name: string }[];
  phase: { index: number; name: string; notes: string; board: Board };
  my_assignment: Assignment | null;
  assignments?: Assignment[];
  can_control: boolean;
  round_number: number;
  map: string | null;
  side: Side | null;
  igl: UserRef | null;
  selected_tactic: SideTactic | null;
  side_tactic_count: number;
  side_tactics?: SideTactic[];
}

export interface SideTactic { tactic_id: number; tactic_name: string; economy: string }

export interface GameState {
  session: GameSession | null;
  last_ended: { session_id: number; ended_at: string; ended_by: UserRef | null; tactic_name: string } | null;
  can_control: boolean;
  igl?: UserRef | null;
}

export interface Profile {
  user_id: number;
  user_name: string;
  avatar_url: string | null;
  language: string | null;
  region: string | null;
  rank_platform: string | null;
  rank_id: string | null;
  legacy_platform: string | null;
  legacy_skill_level: string | null;
  bio: string | null;
  steam_url: string | null;
  faceit_url: string | null;
  esea_url: string | null;
  hltv_url: string | null;
  email?: string;
  team?: { team_id: number; team_name: string } | null;
}

export interface PlayerSummary {
  user_id: number;
  user_name: string;
  avatar_url: string | null;
  language: string | null;
  region: string | null;
  rank_platform: string | null;
  rank_id: string | null;
  legacy_platform: string | null;
  legacy_skill_level: string | null;
  invite_status: 'pending' | null;
}

export interface RecruitingTeam {
  team_id: number;
  team_name: string;
  logo_url: string | null;
  language: string | null;
  region: string | null;
  platform: string | null;
  skill_level: string | null;
  description: string | null;
  recruiting_leagues: string | null;
  roles_needed: PlayerRole[];
  recruiting_notes: string | null;
  roster_size: number;
  request_status: 'pending' | 'invited' | null;
  can_request: boolean;
  is_member: boolean;
}

export interface ReceivedInvite extends Invite {
  team: { team_id: number; team_name: string; logo_url: string | null; region: string | null; language: string | null;
    platform: string | null; skill_level: string | null; roster_size: number };
}

export interface JoinRequest {
  request_id: number;
  team_id: number;
  user_id: number;
  user_name: string;
  avatar_url: string | null;
  language: string | null;
  region: string | null;
  rank_platform: string | null;
  rank_id: string | null;
  legacy_platform: string | null;
  legacy_skill_level: string | null;
  message: string;
  status: 'pending' | 'invited' | 'declined';
  created_at: string;
  has_team: boolean;
}

export interface TeamEvent {
  event_id: number;
  team_id: number;
  kind: 'training' | 'game' | 'demo_review';
  demo_id: number | null;
  demo: { demo_id: number; title: string; status: DemoStatus } | null;
  title: string;
  starts_at: string;
  time_zone: string;
  opponent: string | null;
  notes: string;
  updated_at: string;
}

export interface AppNotification {
  notification_id: number;
  kind: string;
  message: string;
  created_at: string;
  read: boolean;
}

// ---- Shared tactics -----------------------------------------------------------
export interface SharedListing {
  share_id: number;
  tactic_name: string;
  map: string;
  side: Side;
  economy: string;
  phase_count: number;
  import_count: number;
  published_at: string;
  updated_at: string;
  score: number;
  upvotes: number;
  downvotes: number;
  my_vote: -1 | 0 | 1;
  is_mine: boolean;
}
export interface SharedPhase {
  name: string;
  notes: string;
  board: Board;
  assignments: { slot: number; instruction: string; utility: string }[];
}
export interface SharedTactic extends SharedListing {
  grenade: number;
  molly: number;
  flash: number;
  smoke: number;
  slot_count: number;
  phases: SharedPhase[];
}
export interface SharePreview {
  listing: SharedListing | null;
  preview: { tactic: TacticFields; slot_count: number; phases: SharedPhase[] };
  image_count: number;
  dropped_players: number;
  out_of_date: boolean;
}

// ---- Demo Review ----------------------------------------------------------------
export type DemoStatus = 'queued' | 'processing' | 'ready' | 'failed';
export interface DemoSummary {
  demo_id: number;
  team_id: number;
  title: string;
  original_name: string;
  byte_size: number;
  status: DemoStatus;
  error_code: string | null;
  error_message: string | null;
  map: string | null;
  tickrate: number | null;
  round_count: number | null;
  uploaded_by: UserRef | null;
  created_at: string;
  processed_at: string | null;
}
export interface DemoRoundInfo {
  round_number: number;
  start_tick: number;
  freeze_end_tick: number | null;
  end_tick: number;
  winner: 'T' | 'CT' | null;
  reason: string | null;
  ct_score: number | null;
  t_score: number | null;
}
export interface DemoDetail extends DemoSummary {
  players: { index: number; name: string }[];
  rounds: DemoRoundInfo[];
}
export interface ReplayEvent {
  tick: number;
  type: 'kill' | 'plant' | 'defuse' | 'explode' | 'round_end';
  attacker?: number | null;
  victim?: number | null;
  player?: number | null;
  weapon?: string | null;
  headshot?: boolean;
  winner?: string | null;
  reason?: string | null;
  x?: number;
  y?: number;
  level?: Level;
}
export interface ReplayRound {
  round_number: number;
  tickrate: number;
  step: number;
  first_tick: number;
  start_tick: number;
  freeze_end_tick: number | null;
  end_tick: number;
  ct_score?: number;
  t_score?: number;
  roster: { player: number; side: 'T' | 'CT' }[];
  tracks: { x: number[]; y: number[]; l: number[]; yaw: number[]; hp: number[] }[];
  events: ReplayEvent[];
}
export interface Annotation {
  annotation_id: number;
  round_number: number;
  tick: number;
  level: Level;
  kind: 'drawing' | 'text';
  data: { points?: Point[]; x?: number; y?: number; text?: string; color?: string };
  review_id: number | null;
  author: UserRef | null;
  created_at: string;
}
export interface LiveReview {
  review_id: number;
  team_id: number;
  status: 'active' | 'ended';
  version: number;
  demo: { demo_id: number; title: string; map: string; tickrate: number; round_count: number };
  round_number: number;
  playing: boolean;
  speed: number;
  anchor_tick: number;
  anchor_at: string;
  position_tick: number;
  server_time: string;
  started_by: UserRef | null;
  igl: UserRef | null;
  can_control: boolean;
  annotations: Annotation[];
}

// ---- Player Stats -----------------------------------------------------------------
export interface StatsSource {
  source: 'demo' | 'faceit';
  label: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  kd: number | null;
  kd_no_deaths: boolean;
  adr: number | null;
  adr_matches: number;
  hs_pct: number | null;
  last_updated: string | null;
  recent: { map: string | null; played_at: string | null; result: 'W' | 'L' | 'D' | null; kills: number | null; deaths: number | null; assists: number | null; score: string | null }[];
}
export interface ProviderRating { provider: string; nickname: string | null; rating: number | null; level: number | null; status?: string; error?: string | null; last_synced_at: string | null }
export interface PlayerStatsResponse {
  shared?: boolean;
  steam_linked?: boolean;
  tracking?: boolean;
  visibility?: 'private' | 'profile';
  sources?: StatsSource[];
  providers?: ProviderRating[];
}
export interface Identities { steam: { steamid64: string; linked_at: string } | null; has_password: boolean; email: string | null; match_tracking: boolean; steam_web_api: boolean }
export interface FaceitStatus {
  configured: boolean;
  connection: { nickname: string | null; rating: number | null; level: number | null; status: string; error: string | null; last_synced_at: string | null; next_sync_at: string | null } | null;
}
