import type { ECONOMIES, MARKER_KINDS, PLAYER_ROLES, SIDES } from './constants';

export type Side = (typeof SIDES)[number];
export type Economy = (typeof ECONOMIES)[number];
export type MarkerKind = (typeof MARKER_KINDS)[number];
export type PlayerRole = (typeof PLAYER_ROLES)[number];

export interface Point { x: number; y: number }
export interface Marker { id: string; kind: MarkerKind; x: number; y: number; user_id: number | null; label: string }
export interface Route { id: string; user_id: number | null; color: string; points: Point[] }
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
}

export interface RosterResponse {
  team: Team;
  members: Member[];
  viewer: { is_owner: boolean; is_igl: boolean; can_lead: boolean };
}

export interface Invite {
  invite_id: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  max_uses: number | null;
  use_count: number;
  status: 'active' | 'expired' | 'revoked' | 'used_up';
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
}

export interface GameState {
  session: GameSession | null;
  last_ended: { session_id: number; ended_at: string; ended_by: UserRef | null; tactic_name: string } | null;
  can_control: boolean;
}
