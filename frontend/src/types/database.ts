// Mirrors the public schema created in migrations 001-005.

export type RoleName =
  | "md"
  | "cfo"
  | "finance"
  | "sales"
  | "delivery_head"
  | "hr"
  | "pm"
  | "admin";

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  role_id: string | null;
  role_name?: RoleName;
  is_active: boolean;
}

export interface CockpitSummary {
  revenue_billed_mtd: number;
  total_outstanding: number;
  total_overdue: number;
  weighted_pipeline: number;
  total_payables: number;
  critical_exceptions: number;
  overdue_actions: number;
  billable_headcount: number;
  bench_headcount: number;
  open_tickets: number;
}

export interface Customer {
  id: string;
  code: string | null;
  name: string;
  customer_group: string | null;
  zoho_books_id: string | null;
  zoho_crm_account_id: string | null;
  account_manager: string | null;
  sales_owner: string | null;
  credit_days: number;
  gstin: string | null;
  pan: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface LineOfBusiness {
  id: string;
  code: string;
  name: string;
}

export interface SalesEngine {
  id: string;
  code: string;
  name: string;
}

export interface ProjectRow {
  id: string;
  project_code: string;
  name: string;
  customer_id: string;
  lob_id: string | null;
  sales_engine_id: string | null;
  billing_type: "fixed_price" | "time_and_material" | "retainer" | "milestone" | null;
  start_date: string | null;
  end_date: string | null;
  contract_value: number | null;
  margin_threshold: number;
  status: "pipeline" | "active" | "on_hold" | "closed" | "cancelled";
  description: string | null;
  created_at?: string;
  // joined client-side for display
  customer_name?: string;
}

export interface EmployeeRow {
  id: string;
  employee_code: string;
  full_name: string;
  email: string | null;
  department: string | null;
  designation: string | null;
  role: string | null;
  is_billable: boolean;
  cost_rate_monthly: number | null;
  cost_rate_hourly: number | null;
  joining_date: string | null;
  exit_date: string | null;
  is_active: boolean;
  created_at?: string;
}
