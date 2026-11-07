// ─── Enums / Literals ────────────────────────────────────────────────────────

export type UserRole     = 'Admin' | 'Sales' | 'Pre-Sales' | 'Delivery' | 'Finance' | 'Legal';
export type LOB          = 'SAP Implementation – Rise' | 'SAP Implementation – Grow' | 'AMS' | 'Resource Augmentation' | 'Upgrade / Migration' | 'BTP / AI' | 'Tender';
export type RiskLevel    = 'Low' | 'Medium' | 'High' | 'Critical';
export type ProposalStatus =
  | 'Draft' | 'Pre-Sales Review' | 'Delivery Review' | 'Finance Review'
  | 'Legal Review' | 'Final Approval' | 'Submitted' | 'Won' | 'Lost' | 'Ready for Export' | 'Archived';

/** Pyramid level used for staffing mix analysis */
export type RoleLevel = 'Junior' | 'Mid' | 'Senior' | 'Principal';

/** Where the resource is physically deployed */
export type LocationType = 'Offshore' | 'Onsite' | 'Hybrid';

// ─── RateCard ─────────────────────────────────────────────────────────────────

export interface RateCard {
  id: string;
  skill: string;
  roleLevel: RoleLevel;        // for pyramid health
  experienceBand: string;      // display label
  geography: string;
  locationType: LocationType;
  currency: string;

  billingRate: number;         // $/hr charged to client
  costRate: number;            // direct salary cost $/hr

  // ── Split overhead loading (Priority 3) ──────────────────────────────────
  benchPercentage: number;     // bench / non-billable time cost
  trainingPercentage: number;  // certifications, L&D
  infraPercentage: number;     // laptop, tools, office allocation
  costLoadingPercentage: number; // derived: bench + training + infra

  loadedCostRate: number;      // costRate × (1 + totalLoading/100)

  // ── Utilisation-adjusted costs (Priority 1) ──────────────────────────────
  utilisationRate: number;          // e.g. 0.80 = 80% billable
  effectiveCostRate: number;        // costRate ÷ utilisationRate
  effectiveLoadedCostRate: number;  // loadedCostRate ÷ utilisationRate

  // ── Margins ───────────────────────────────────────────────────────────────
  margin: number;                              // active margin (switches with costing method)
  marginalMargin: number;                      // (billing − directCost) / billing
  absorptionMargin: number;                    // (billing − loadedCost) / billing
  utilisationAdjustedMarginalMargin: number;   // (billing − effectiveCost) / billing
  utilisationAdjustedAbsorptionMargin: number; // (billing − effectiveLoadedCost) / billing
}

function buildRateCard(
  id: string,
  skill: string,
  roleLevel: RoleLevel,
  geography: string,
  locationType: LocationType,
  experienceBand: string,
  billingRate: number,
  costRate: number,
  benchPct: number,
  trainingPct: number,
  infraPct: number,
  currency: string,
  utilisationRate = 0.80,
): RateCard {
  const costLoadingPercentage    = benchPct + trainingPct + infraPct;
  const loadedCostRate           = Math.round(costRate * (1 + costLoadingPercentage / 100));
  const effectiveCostRate        = Math.round(costRate / utilisationRate);
  const effectiveLoadedCostRate  = Math.round(loadedCostRate / utilisationRate);

  const marginalMargin                      = billingRate > 0 ? Math.round(((billingRate - costRate)               / billingRate) * 100) : 0;
  const absorptionMargin                    = billingRate > 0 ? Math.round(((billingRate - loadedCostRate)         / billingRate) * 100) : 0;
  const utilisationAdjustedMarginalMargin   = billingRate > 0 ? Math.round(((billingRate - effectiveCostRate)      / billingRate) * 100) : 0;
  const utilisationAdjustedAbsorptionMargin = billingRate > 0 ? Math.round(((billingRate - effectiveLoadedCostRate)/ billingRate) * 100) : 0;

  return {
    id, skill, roleLevel, experienceBand, geography, locationType, currency,
    billingRate, costRate,
    benchPercentage: benchPct, trainingPercentage: trainingPct, infraPercentage: infraPct,
    costLoadingPercentage, loadedCostRate,
    utilisationRate, effectiveCostRate, effectiveLoadedCostRate,
    margin: marginalMargin,
    marginalMargin, absorptionMargin,
    utilisationAdjustedMarginalMargin, utilisationAdjustedAbsorptionMargin,
  };
}

//                          id        skill                              level       geo     loc         band             bill    cost   bench  trn  infra  curr   util
// India Offshore — rates in INR/hr (market FY2026-27)
// USA Onsite     — rates in USD/hr
export const rateCards: RateCard[] = [
  buildRateCard('RC-001', 'SAP Solution Architect',        'Principal', 'India', 'Offshore', '15+ years',    4500,  2200, 15, 5, 5, 'INR', 0.80),
  buildRateCard('RC-002', 'SAP FI/CO Lead',                'Senior',    'India', 'Offshore', '12-15 years',  3500,  1650, 15, 5, 5, 'INR', 0.80),
  buildRateCard('RC-003', 'SAP MM/SD Consultant',          'Mid',       'India', 'Offshore', '8-12 years',   2500,  1150, 15, 5, 5, 'INR', 0.82),
  buildRateCard('RC-004', 'SAP ABAP Developer',            'Mid',       'India', 'Offshore', '8-12 years',   2200,  1000, 15, 5, 5, 'INR', 0.82),
  buildRateCard('RC-005', 'SAP BASIS Administrator',       'Senior',    'India', 'Offshore', '12-15 years',  2800,  1300, 15, 5, 5, 'INR', 0.80),
  buildRateCard('RC-006', 'SAP BTP Developer',             'Mid',       'India', 'Offshore', '4-8 years',    2000,   900, 15, 8, 5, 'INR', 0.82),
  buildRateCard('RC-007', 'Project Manager',               'Principal', 'India', 'Hybrid',   '12-15 years',  4000,  1900, 15, 5, 5, 'INR', 0.78),
  buildRateCard('RC-008', 'SAP Fiori Developer',           'Mid',       'India', 'Offshore', '4-8 years',    1800,   800, 15, 8, 5, 'INR', 0.82),
  buildRateCard('RC-009', 'SAP FI Consultant',             'Senior',    'USA',   'Onsite',   '12-15 years',   220,   120, 12, 5, 8, 'USD', 0.75),
  buildRateCard('RC-010', 'Change Management Consultant',  'Senior',    'USA',   'Onsite',   '8-12 years',    190,   105, 12, 5, 8, 'USD', 0.75),
  buildRateCard('RC-011', 'SAP FI/CO Junior Consultant',   'Junior',    'India', 'Offshore', '0-3 years',    1000,   450, 18, 8, 5, 'INR', 0.85),
  buildRateCard('RC-012', 'SAP MM/SD Junior Consultant',   'Junior',    'India', 'Offshore', '0-3 years',     900,   400, 18, 8, 5, 'INR', 0.85),
  buildRateCard('RC-013', 'SAP Solution Architect',        'Principal', 'USA',   'Onsite',   '15+ years',     280,   155, 12, 5, 8, 'USD', 0.75),
  buildRateCard('RC-014', 'SAP QM/PM Consultant',          'Mid',       'India', 'Offshore', '6-10 years',   2200,  1000, 15, 5, 5, 'INR', 0.82),
  buildRateCard('RC-015', 'SAP PP Consultant',             'Mid',       'India', 'Offshore', '6-10 years',   2300,  1050, 15, 5, 5, 'INR', 0.82),
  buildRateCard('RC-016', 'SAP HR/HCM Consultant',         'Mid',       'India', 'Offshore', '6-10 years',   2200,  1000, 15, 5, 5, 'INR', 0.82),
  buildRateCard('RC-017', 'SAP SD Consultant',             'Senior',    'India', 'Offshore', '12-15 years',  3200,  1500, 15, 5, 5, 'INR', 0.80),
  buildRateCard('RC-018', 'SAP WM/EWM Consultant',         'Mid',       'India', 'Offshore', '6-10 years',   2400,  1100, 15, 5, 5, 'INR', 0.82),
  buildRateCard('RC-019', 'SAP Functional Consultant',     'Junior',    'India', 'Offshore', '1-3 years',    1100,   500, 18, 8, 5, 'INR', 0.85),
  buildRateCard('RC-020', 'SAP Technical Consultant',      'Junior',    'India', 'Offshore', '1-3 years',    1000,   450, 18, 8, 5, 'INR', 0.85),
];

// ─── Other types (unchanged) ──────────────────────────────────────────────────

/** Rich form fields collected during the New Proposal wizard that don't have
 *  dedicated DB columns — stored as a JSON blob in proposals.metadata. */
export interface ProposalMetadata {
  // Step 0
  proposalType?: string;
  // Step 1 — Scope Details
  projectType?: string;
  implementationModel?: string;
  supportWindow?: string;
  slaReqs?: string;
  integrationReqs?: string;
  customDevScope?: string;
  clientPainPoints?: string;
  mandatoryDeliverables?: string;
  // Step 3 — Commercial Details
  billingModel?: string;
  paymentMilestone?: string;
  commercialNotes?: string;
  // Step 4 — Risk & Constraints
  timelinePressure?: string;
  clientContractFormat?: string;
  securityCompliance?: string;
  specialResources?: string;
  mandatoryLegalClauses?: string;
  dependencyRisks?: string;
  deliveryAssumptions?: string;
  exclusions?: string;
  // Step 5 — Internal Notes
  salesNotes?: string;
  presalesNotes?: string;
  competitorContext?: string;
  winStrategy?: string;
  clientRelationship?: string;
  // RFP source documents
  rfpRawText?: string;
  rfpFiles?: string[];
  rfpSessionId?: string;
  // Pre-Sales Briefing — verified context, resource hours, KB doc selection
  presalesBriefing?: {
    qa: { id: string; category: string; question: string; answer: string; required: boolean }[];
    resourceHours: { roleId: string; skill: string; level: string; location: string; billingRate: number; currency: string; suggestedHours: number; confirmedHours: number; notes: string; status: 'confirmed' | 'tentative' | 'removed' }[];
    presalesNotes: string;
    kbDocIds: string[];
    generatedAt: string;
    completedAt?: string;
  };
  // Rework comments from approval workflow — role-scoped
  reworkComments?: { stage: string; comment: string; category: string; by: string; byRole: string; timestamp: string }[];
  // Persisted proposal sections from workspace
  sections?: { name: string; content: string; status: string }[];
  // Draft state
  draft_step?: number;
  draft_form?: Record<string, unknown>;
  cost_lines?: unknown[];
  resource_hours?: Record<string, number>;
  selected_role_ids?: string[];
  ai_consultant_ids?: string[];
  ai_gap_role_ids?: string[];
  ai_reasons?: Record<string, string>;
  ai_estimate?: unknown;
  costing_mode?: string;
  // Cover letter — mandatory for all proposals
  coverLetter?: {
    legalName: string; corporateStructure: string;
    contactName: string; contactTitle: string; contactAddress: string;
    contactPhone: string; contactEmail: string;
    hasSubcontractors: string; subcontractorDetails: string;
    pendingLitigation: string; litigationDetails: string;
    bankruptcyLast5Yrs: string; bankruptcyDetails: string;
    validityDays: number; authorisedSignatory: string; signatoryTitle: string;
    additionalNotes: string;
  };
  // RFP compliance checklist — warn-only, never blocks submission
  complianceChecklist?: {
    rfpTitle: string;
    extractedAt: string;
    items: { id: string; category: string; requirement: string; value?: string; met: boolean; notes: string; severity: 'critical' | 'major' | 'minor' }[];
    overallStatus: 'compliant' | 'partial' | 'non-compliant';
  };
}

export interface Proposal {
  id: string; title: string; clientName: string; clientGroup: string;
  industry: string; geography: string; lob: LOB; opportunityType: LOB;
  owner: string; status: ProposalStatus; createdAt: string; updatedAt: string;
  submissionDate: string; priority: 'Low' | 'Medium' | 'High' | 'Critical';
  dealType: 'Fixed Price' | 'Time & Material' | 'Hybrid';
  currency: string; expectedDuration: string; expectedRevenue: number;
  grossMargin: number; discount: number; modules: string[];
  riskLevel: RiskLevel; approvalProgress: number;
  /** Rich wizard data — scope, risk, internal notes, commercial detail */
  metadata?: ProposalMetadata;
}

export interface KnowledgeItem {
  id: string; title: string; type: string; lob: string; industry: string;
  geography: string; modules: string[]; version: string;
  approvalStatus: 'Approved' | 'Draft' | 'Under Review' | 'Pending' | 'Archived'; owner: string;
  uploadDate: string; lastUpdated: string;
}

export interface CommercialRule {
  id: string; rule: string; value: string; status: string;
}

export interface ApprovalRecord {
  id: string; proposalId: string; proposalTitle: string; stage: ProposalStatus;
  approver: string; approverRole: UserRole;
  decision: 'Approved' | 'Rejected' | 'Pending' | 'Sent Back';
  comments: string; timestamp: string;
}

export const sapModules = ['FI', 'CO', 'MM', 'SD', 'HR', 'PP', 'QM', 'PM', 'ABAP', 'BASIS', 'BTP', 'Fiori', 'Ariba', 'WM', 'EWM', 'Others'];

export const proposals: Proposal[] = [
  { id: 'PIP-2026-001', title: 'SAP S/4HANA Rise – Tata Steel', clientName: 'Tata Steel', clientGroup: 'Tata Group', industry: 'Manufacturing', geography: 'India', lob: 'SAP Implementation – Rise', opportunityType: 'SAP Implementation – Rise', owner: 'Ankit Verma', status: 'Finance Review', createdAt: '2026-03-01', updatedAt: '2026-04-01', submissionDate: '2026-04-15', priority: 'Critical', dealType: 'Fixed Price', currency: 'INR', expectedDuration: '18 months', expectedRevenue: 45000000, grossMargin: 38, discount: 3, modules: ['FI', 'CO', 'MM', 'SD', 'PP'], riskLevel: 'Medium', approvalProgress: 60 },
  { id: 'PIP-2026-002', title: 'AMS Support for Reliance Industries', clientName: 'Reliance Industries', clientGroup: 'Reliance Group', industry: 'Energy', geography: 'India', lob: 'AMS', opportunityType: 'AMS', owner: 'Priya Nair', status: 'Pre-Sales Review', createdAt: '2026-03-10', updatedAt: '2026-04-05', submissionDate: '2026-04-20', priority: 'High', dealType: 'Time & Material', currency: 'INR', expectedDuration: '24 months', expectedRevenue: 28000000, grossMargin: 42, discount: 0, modules: ['FI', 'MM', 'SD'], riskLevel: 'Low', approvalProgress: 20 },
  { id: 'PIP-2026-003', title: 'Resource Augmentation – Infosys BFS', clientName: 'Infosys BFS', clientGroup: 'Infosys', industry: 'IT Services', geography: 'India', lob: 'Resource Augmentation', opportunityType: 'Resource Augmentation', owner: 'Deepak Kumar', status: 'Draft', createdAt: '2026-03-20', updatedAt: '2026-04-06', submissionDate: '2026-05-01', priority: 'Medium', dealType: 'Time & Material', currency: 'USD', expectedDuration: '6 months', expectedRevenue: 180000, grossMargin: 35, discount: 0, modules: ['ABAP', 'BASIS'], riskLevel: 'Low', approvalProgress: 0 },
  { id: 'PIP-2026-004', title: 'SAP S/4HANA Grow – M&M', clientName: 'Mahindra & Mahindra', clientGroup: 'Mahindra Group', industry: 'Automotive', geography: 'India', lob: 'SAP Implementation – Grow', opportunityType: 'SAP Implementation – Grow', owner: 'Ankit Verma', status: 'Legal Review', createdAt: '2026-02-15', updatedAt: '2026-04-01', submissionDate: '2026-04-10', priority: 'Critical', dealType: 'Fixed Price', currency: 'INR', expectedDuration: '14 months', expectedRevenue: 32000000, grossMargin: 36, discount: 5, modules: ['FI', 'CO', 'SD', 'MM', 'PP', 'QM'], riskLevel: 'High', approvalProgress: 80 },
  { id: 'PIP-2026-005', title: 'BTP & AI – HDFC Bank', clientName: 'HDFC Bank', clientGroup: 'HDFC Group', industry: 'Banking & Finance', geography: 'India', lob: 'BTP / AI', opportunityType: 'BTP / AI', owner: 'Priya Nair', status: 'Delivery Review', createdAt: '2026-03-05', updatedAt: '2026-04-06', submissionDate: '2026-04-25', priority: 'High', dealType: 'Fixed Price', currency: 'INR', expectedDuration: '9 months', expectedRevenue: 15000000, grossMargin: 44, discount: 2, modules: ['BTP', 'Fiori', 'ABAP'], riskLevel: 'Medium', approvalProgress: 40 },
  { id: 'PIP-2026-006', title: 'SAP Upgrade – L&T', clientName: 'L&T Ltd', clientGroup: 'L&T Group', industry: 'Engineering', geography: 'India', lob: 'Upgrade / Migration', opportunityType: 'Upgrade / Migration', owner: 'Deepak Kumar', status: 'Final Approval', createdAt: '2026-02-01', updatedAt: '2026-04-05', submissionDate: '2026-04-12', priority: 'Critical', dealType: 'Fixed Price', currency: 'INR', expectedDuration: '8 months', expectedRevenue: 18000000, grossMargin: 33, discount: 7, modules: ['FI', 'CO', 'BASIS'], riskLevel: 'High', approvalProgress: 90 },
  { id: 'PIP-2026-007', title: 'Government Tender – NIC SAP Implementation', clientName: 'NIC', clientGroup: 'Government of India', industry: 'Government', geography: 'India', lob: 'Tender', opportunityType: 'Tender', owner: 'Ankit Verma', status: 'Pre-Sales Review', createdAt: '2026-03-25', updatedAt: '2026-04-06', submissionDate: '2026-04-30', priority: 'High', dealType: 'Fixed Price', currency: 'INR', expectedDuration: '24 months', expectedRevenue: 75000000, grossMargin: 28, discount: 0, modules: ['FI', 'CO', 'MM', 'SD', 'HR', 'PP'], riskLevel: 'Critical', approvalProgress: 15 },
  { id: 'PIP-2026-008', title: 'AMS – Wipro Consumer Care', clientName: 'Wipro Consumer Care', clientGroup: 'Wipro', industry: 'FMCG', geography: 'India', lob: 'AMS', opportunityType: 'AMS', owner: 'Priya Nair', status: 'Ready for Export', createdAt: '2026-01-15', updatedAt: '2026-04-01', submissionDate: '2026-04-08', priority: 'Medium', dealType: 'Time & Material', currency: 'INR', expectedDuration: '12 months', expectedRevenue: 12000000, grossMargin: 40, discount: 0, modules: ['FI', 'MM', 'SD'], riskLevel: 'Low', approvalProgress: 100 },
  { id: 'PIP-2026-009', title: 'SAP Rise – Adani Ports', clientName: 'Adani Ports', clientGroup: 'Adani Group', industry: 'Logistics', geography: 'India', lob: 'SAP Implementation – Rise', opportunityType: 'SAP Implementation – Rise', owner: 'Deepak Kumar', status: 'Submitted', createdAt: '2026-01-20', updatedAt: '2026-03-15', submissionDate: '2026-03-20', priority: 'Critical', dealType: 'Fixed Price', currency: 'INR', expectedDuration: '20 months', expectedRevenue: 55000000, grossMargin: 37, discount: 4, modules: ['FI', 'CO', 'MM', 'SD', 'PM'], riskLevel: 'Medium', approvalProgress: 100 },
  { id: 'PIP-2026-010', title: 'Resource Augmentation – TCS', clientName: 'TCS', clientGroup: 'Tata Group', industry: 'IT Services', geography: 'Global', lob: 'Resource Augmentation', opportunityType: 'Resource Augmentation', owner: 'Ankit Verma', status: 'Draft', createdAt: '2026-04-01', updatedAt: '2026-04-06', submissionDate: '2026-05-15', priority: 'Low', dealType: 'Time & Material', currency: 'USD', expectedDuration: '12 months', expectedRevenue: 480000, grossMargin: 32, discount: 0, modules: ['FI', 'CO', 'BASIS'], riskLevel: 'Low', approvalProgress: 0 },
];

export const knowledgeItems: KnowledgeItem[] = [
  { id: 'KB-001', title: 'AIS Company Profile 2026', type: 'Company Profile', lob: 'All', industry: 'All', geography: 'Global', modules: [], version: '3.2', approvalStatus: 'Approved', owner: 'Admin', uploadDate: '2026-01-15', lastUpdated: '2026-03-01' },
  { id: 'KB-002', title: 'SAP S/4HANA Rise Implementation Methodology', type: 'Delivery Methodology', lob: 'SAP Implementation – Rise', industry: 'All', geography: 'Global', modules: ['FI', 'CO', 'MM', 'SD'], version: '2.1', approvalStatus: 'Approved', owner: 'Pre-Sales', uploadDate: '2026-01-20', lastUpdated: '2026-02-15' },
  { id: 'KB-003', title: 'Tata Steel ERP Case Study', type: 'Case Study', lob: 'SAP Implementation – Rise', industry: 'Manufacturing', geography: 'India', modules: ['FI', 'CO', 'PP'], version: '1.0', approvalStatus: 'Approved', owner: 'Sales', uploadDate: '2025-11-10', lastUpdated: '2025-11-10' },
  { id: 'KB-004', title: 'ISO 27001 & CMMI Level 5 Certifications', type: 'Credentials', lob: 'All', industry: 'All', geography: 'Global', modules: [], version: '1.3', approvalStatus: 'Approved', owner: 'Admin', uploadDate: '2025-08-01', lastUpdated: '2026-01-05' },
  { id: 'KB-005', title: 'Standard NDA Template', type: 'Legal Clause', lob: 'All', industry: 'All', geography: 'India', modules: [], version: '4.0', approvalStatus: 'Approved', owner: 'Legal', uploadDate: '2025-06-15', lastUpdated: '2026-02-20' },
  { id: 'KB-006', title: 'India Rate Card FY2026-27', type: 'Rate Card', lob: 'All', industry: 'All', geography: 'India', modules: [], version: '2.0', approvalStatus: 'Approved', owner: 'Finance', uploadDate: '2026-04-01', lastUpdated: '2026-04-01' },
];

export const approvalRecords: ApprovalRecord[] = [
  { id: 'APR-001', proposalId: 'PIP-2026-001', proposalTitle: 'SAP S/4HANA Rise – Tata Steel', stage: 'Pre-Sales Review', approver: 'Amit Saxena', approverRole: 'Pre-Sales', decision: 'Approved', comments: 'Solution approach looks solid.', timestamp: '2026-03-15 10:30' },
  { id: 'APR-002', proposalId: 'PIP-2026-001', proposalTitle: 'SAP S/4HANA Rise – Tata Steel', stage: 'Delivery Review', approver: 'Pooja Sharma', approverRole: 'Delivery', decision: 'Approved', comments: 'Timeline is tight but feasible.', timestamp: '2026-03-22 14:15' },
  { id: 'APR-003', proposalId: 'PIP-2026-001', proposalTitle: 'SAP S/4HANA Rise – Tata Steel', stage: 'Finance Review', approver: 'CFO Office', approverRole: 'Finance', decision: 'Pending', comments: '', timestamp: '2026-04-01 09:00' },
  { id: 'APR-004', proposalId: 'PIP-2026-004', proposalTitle: 'SAP S/4HANA Grow – M&M', stage: 'Legal Review', approver: 'Legal Team', approverRole: 'Legal', decision: 'Pending', comments: 'IP clause deviation under review.', timestamp: '2026-04-02 09:30' },
];

// ─── Missing exports (required by other pages) ────────────────────────────────

export const proposalStages: ProposalStatus[] = [
  'Draft', 'Pre-Sales Review', 'Delivery Review', 'Finance Review',
  'Legal Review', 'Final Approval', 'Ready for Export', 'Submitted', 'Archived',
];

export interface LegalClause {
  id: string;
  category: string;
  title: string;
  version: string;
  standardText: string;
  status: 'Active' | 'Inactive';
  lastUpdated: string;
  notes: string;
}

export const legalClauses: LegalClause[] = [
  {
    id: 'LC-001', category: 'NDA', title: 'Standard Non-Disclosure Agreement', version: '4.0', status: 'Active', lastUpdated: '2026-02-20', notes: 'Standard for all engagements',
    standardText: `Each party ("Disclosing Party") may disclose to the other party ("Receiving Party") certain confidential and proprietary information ("Confidential Information") in connection with this engagement. The Receiving Party agrees to: (a) hold all Confidential Information in strict confidence using at least the same degree of care it uses to protect its own confidential information, but in no event less than reasonable care; (b) not disclose Confidential Information to any third party without the prior written consent of the Disclosing Party; (c) use Confidential Information solely for the purpose of evaluating or performing the engagement described herein; and (d) limit access to Confidential Information to those employees, contractors, or advisors who have a need to know and who are bound by obligations of confidentiality at least as protective as those set forth herein. These obligations shall survive termination of this agreement for a period of three (3) years. Confidential Information shall not include information that: (i) is or becomes publicly available through no breach of this agreement; (ii) was rightfully known to the Receiving Party prior to disclosure; (iii) is independently developed without use of the Confidential Information; or (iv) is required to be disclosed by law or court order, provided the Disclosing Party is given reasonable prior notice.`,
  },
  {
    id: 'LC-002', category: 'Confidentiality', title: 'Confidentiality and Data Protection', version: '3.1', status: 'Active', lastUpdated: '2026-01-15', notes: 'Required for BFSI clients',
    standardText: `Tower-CEO Technologies Pvt. Ltd. ("AIS") shall treat all Client data, business information, technical specifications, financial data, customer information, and personnel data as strictly confidential. AIS shall: (a) implement and maintain appropriate technical and organisational measures to protect Client data against unauthorised access, disclosure, alteration, or destruction, consistent with AIS's ISO/IEC 27001:2022 certification; (b) process Client data only as necessary to perform the services described in this agreement and the applicable Statement of Work; (c) not transfer Client data outside India without prior written consent, unless required for the performance of cloud-hosted services expressly agreed in the SOW; (d) notify the Client without undue delay, and in any event within 72 hours, upon becoming aware of any actual or suspected breach involving Client data; (e) upon termination or expiry of this agreement, securely delete or return all Client data within 30 days, as directed by the Client; and (f) ensure that all AIS personnel and sub-contractors handling Client data are bound by equivalent confidentiality obligations. These obligations are in addition to and not in substitution of any applicable data protection legislation, including the Information Technology Act 2000 and the Digital Personal Data Protection Act 2023.`,
  },
  {
    id: 'LC-003', category: 'IP', title: 'Intellectual Property Rights', version: '2.5', status: 'Active', lastUpdated: '2026-03-01', notes: 'Standard IP clause; custom IP requires legal approval',
    standardText: `(a) Pre-Existing IP: Each party retains all rights, title, and interest in and to its pre-existing intellectual property, including methodologies, frameworks, tools, templates, know-how, and proprietary software developed independently of this engagement ("Background IP"). AIS's Background IP includes, without limitation, its delivery accelerators, configuration templates, testing frameworks, and internal tooling. Nothing in this agreement shall be construed as a transfer of Background IP. (b) Deliverable IP: Subject to full payment of all fees due under this agreement, AIS grants the Client a perpetual, non-exclusive, royalty-free licence to use all work products and deliverables created specifically for the Client under this engagement ("Deliverable IP") for the Client's internal business purposes. (c) Residual Knowledge: AIS and its personnel shall be free to use any general knowledge, skills, experience, ideas, concepts, know-how, and techniques retained in unaided human memory that are acquired during the performance of the engagement, provided such use does not breach any obligation of confidentiality or disclose any Client Confidential Information. (d) Third-Party IP: AIS shall obtain all necessary licences for any third-party intellectual property incorporated into the deliverables and shall notify the Client of any third-party licence terms that affect the Client's use of the deliverables.`,
  },
  {
    id: 'LC-004', category: 'Limitation of Liability', title: 'Limitation of Liability', version: '3.0', status: 'Active', lastUpdated: '2025-12-15', notes: 'Cap at contract value; deviations need CFO approval',
    standardText: `(a) Liability Cap: The total aggregate liability of either party to the other in connection with this agreement, whether arising in contract, tort (including negligence), breach of statutory duty, or otherwise, shall not exceed the total fees actually paid or payable by the Client to AIS under this agreement in the twelve (12) months immediately preceding the event giving rise to the claim. (b) Exclusion of Consequential Loss: Neither party shall be liable to the other for any: (i) loss of profits, revenue, or anticipated savings; (ii) loss of business or contracts; (iii) loss of data or information (beyond the cost of restoration from backup); (iv) loss of goodwill or reputation; or (v) indirect, special, incidental, or consequential loss or damage, even if advised of the possibility of such loss. (c) Exceptions: The limitations and exclusions in this clause shall not apply to: (i) death or personal injury caused by negligence; (ii) fraud or fraudulent misrepresentation; (iii) wilful misconduct or gross negligence; (iv) breach of confidentiality obligations; or (v) any liability that cannot be excluded or limited by applicable law. (d) Mitigation: Each party shall take reasonable steps to mitigate any loss or damage it suffers.`,
  },
  {
    id: 'LC-005', category: 'Indemnity', title: 'Indemnification', version: '2.2', status: 'Active', lastUpdated: '2026-01-20', notes: 'Mutual indemnity standard',
    standardText: `(a) By AIS: AIS shall defend, indemnify, and hold harmless the Client and its officers, directors, employees, and agents from and against any third-party claims, actions, damages, liabilities, costs, and expenses (including reasonable legal fees) arising from or relating to: (i) any infringement or alleged infringement of a third party's intellectual property rights by the deliverables or AIS's Background IP used in the engagement; (ii) the gross negligence or wilful misconduct of AIS personnel; or (iii) any breach by AIS of its confidentiality or data protection obligations under this agreement. (b) By the Client: The Client shall defend, indemnify, and hold harmless AIS and its officers, directors, employees, and agents from and against any third-party claims, actions, damages, liabilities, costs, and expenses (including reasonable legal fees) arising from or relating to: (i) any infringement or alleged infringement of a third party's intellectual property rights by Client-provided materials or data; (ii) the gross negligence or wilful misconduct of Client personnel; or (iii) the Client's use of the deliverables in a manner not authorised by this agreement. (c) Indemnification Procedure: The indemnified party shall: (i) promptly notify the indemnifying party in writing of any claim; (ii) give the indemnifying party sole control of the defence and settlement; and (iii) provide reasonable cooperation at the indemnifying party's expense. The indemnifying party shall not settle any claim in a manner that imposes obligations or restrictions on the indemnified party without prior written consent.`,
  },
  {
    id: 'LC-006', category: 'Termination', title: 'Termination for Convenience', version: '2.0', status: 'Active', lastUpdated: '2025-11-10', notes: '90-day notice standard; 30-day for RA contracts',
    standardText: `(a) Termination for Convenience: Either party may terminate this agreement or any Statement of Work for convenience by providing not less than ninety (90) calendar days' prior written notice to the other party. For Resource Augmentation engagements only, the notice period shall be thirty (30) calendar days. (b) Termination for Cause: Either party may terminate this agreement immediately upon written notice if the other party: (i) commits a material breach of this agreement that is incapable of remedy; (ii) commits a material breach that is capable of remedy but fails to remedy it within thirty (30) days of receiving written notice specifying the breach; (iii) becomes insolvent, makes a general assignment for the benefit of creditors, or becomes subject to any proceeding under any bankruptcy or insolvency law; or (iv) engages in fraudulent, illegal, or grossly negligent conduct in connection with this agreement. (c) Effect of Termination: Upon termination: (i) AIS shall promptly deliver to the Client all completed deliverables and work-in-progress; (ii) the Client shall pay AIS for all services rendered and expenses incurred up to the effective date of termination, including any non-cancellable commitments made by AIS in connection with the engagement; (iii) each party shall return or destroy the other party's Confidential Information as directed; and (iv) clauses that by their nature should survive termination (including confidentiality, IP, limitation of liability, governing law, and payment obligations) shall continue in full force and effect.`,
  },
  {
    id: 'LC-007', category: 'Governing Law', title: 'Governing Law and Jurisdiction', version: '1.5', status: 'Active', lastUpdated: '2025-10-05', notes: 'India jurisdiction default; client geography exceptions possible',
    standardText: `(a) Governing Law: This agreement and any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with it or its subject matter or formation shall be governed by and construed in accordance with the laws of India, without regard to its conflict of law provisions. (b) Jurisdiction: Each party irrevocably agrees that the courts of Pune, Maharashtra, India shall have exclusive jurisdiction to settle any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with this agreement or its subject matter or formation. Each party irrevocably submits to the personal jurisdiction of such courts for this purpose and waives any objection to the laying of venue of any such proceeding in such courts. (c) Language: This agreement and all communications between the parties in connection with it shall be in the English language. If this agreement is translated into any other language, the English language text shall prevail.`,
  },
  {
    id: 'LC-008', category: 'Force Majeure', title: 'Force Majeure', version: '2.1', status: 'Active', lastUpdated: '2025-09-15', notes: 'Updated post-pandemic',
    standardText: `(a) Neither party shall be in breach of this agreement or liable for delay in performing, or failure to perform, any of its obligations under this agreement if such delay or failure results from a Force Majeure Event. A "Force Majeure Event" means any event beyond a party's reasonable control, including but not limited to: acts of God; flood, drought, earthquake, or other natural disaster; epidemic or pandemic (including any government measures taken in response thereto); terrorist attack, civil war, civil commotion or riots, war, threat of or preparation for war, armed conflict, imposition of sanctions, embargo, or breaking off of diplomatic relations; nuclear, chemical, or biological contamination; any law or any action taken by a government or public authority; collapse of buildings, fire, explosion, or accident; any labour or trade dispute, strike, industrial action, or lockout (other than by the party seeking to rely on this clause); interruption or failure of utility services; or failure of telecommunications networks or the internet. (b) The affected party shall: (i) as soon as reasonably practicable after the start of the Force Majeure Event, notify the other party in writing specifying the Force Majeure Event, the date it started, its likely or potential duration, and the effect of the event on the affected party's ability to perform its obligations; and (ii) use all reasonable endeavours to mitigate the effect of the Force Majeure Event on the performance of its obligations. (c) If a Force Majeure Event continues for more than sixty (60) consecutive days, either party may terminate this agreement on not less than twenty-one (21) days' written notice.`,
  },
  {
    id: 'LC-009', category: 'Non-Solicitation', title: 'Non-Solicitation of Employees', version: '1.8', status: 'Active', lastUpdated: '2026-02-01', notes: '12-month period standard',
    standardText: `(a) Non-Solicitation: During the term of this agreement and for a period of twelve (12) months following its expiry or termination, neither party shall, directly or indirectly: (i) solicit, recruit, induce, or entice away from the other party any employee, contractor, or consultant who was involved in the performance of this agreement; or (ii) employ, engage, or otherwise utilise the services of any such person, whether as an employee, independent contractor, advisor, or otherwise. (b) Exception: The restrictions in clause (a) shall not apply to: (i) general recruitment advertising not specifically targeted at the other party's personnel; (ii) unsolicited applications from individuals who independently approach the relevant party; or (iii) the engagement of individuals who have been separated from the other party's employment or engagement for at least six (6) months prior to the commencement of discussions. (c) Remedy: Each party acknowledges that the restrictions in this clause are reasonable and necessary to protect the legitimate business interests of the other party, and that a breach of this clause may cause irreparable harm for which monetary damages would be an inadequate remedy, entitling the other party to seek injunctive or other equitable relief in addition to any other remedies available at law or in equity. (d) Liquidated Damages: In the event of a breach of this clause, the defaulting party shall pay to the other party as liquidated damages (and not as a penalty) a sum equal to six (6) months' gross compensation of the relevant individual as at the date of the breach.`,
  },
  {
    id: 'LC-010', category: 'Arbitration', title: 'Arbitration Clause', version: '1.3', status: 'Inactive', lastUpdated: '2025-08-20', notes: 'Replaced by LC-007 for most contracts',
    standardText: `Any dispute, controversy, or claim arising out of or relating to this agreement, or the breach, termination, or invalidity thereof, shall be finally settled by arbitration in accordance with the Arbitration and Conciliation Act, 1996 (India) and any amendments thereto. The arbitration shall be conducted by a sole arbitrator mutually appointed by the parties, or if the parties fail to agree on the appointment of a sole arbitrator within thirty (30) days of a dispute being referred to arbitration, by an arbitral tribunal constituted of three arbitrators, one appointed by each party and the third appointed by the two party-appointed arbitrators. The seat and venue of the arbitration shall be Pune, Maharashtra, India. The language of the arbitration shall be English. The award of the arbitral tribunal shall be final and binding on the parties and may be enforced in any court of competent jurisdiction. Each party shall bear its own costs of the arbitration, and the costs of the arbitral tribunal shall be shared equally between the parties, unless the arbitral tribunal determines otherwise.`,
  },
];