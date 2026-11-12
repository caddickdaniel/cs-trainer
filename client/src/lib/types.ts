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
  label: string;
  images?: LineupImage[];
}
export interface Route { id: string; level?: Level; user_id: number | null; color: string; points: Point[] }
export interface Board { markers: Marker[]; routes: Route[] }

export interface Assignment {
  user_id: number;
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
  selected_tactic: { tactic_id: number; tactic_name: string } | null;
  side_tactic_count: number;
  side_tactics?: { tactic_id: number; tactic_name: string }[];
}

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
  platform: string | null;
  skill_level: string | null;
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
  platform: string | null;
  skill_level: string | null;
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
  platform: string | null;
  skill_level: string | null;
  message: string;
  status: 'pending' | 'invited' | 'declined';
  created_at: string;
  has_team: boolean;
}

export interface TeamEvent {
  event_id: number;
  team_id: number;
  kind: 'training' | 'game';
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
