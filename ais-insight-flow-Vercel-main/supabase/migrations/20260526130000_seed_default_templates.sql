-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Default Proposal Templates
-- Run this in Supabase SQL Editor to populate the proposal_templates table.
-- Safe to re-run — uses INSERT ... WHERE NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.proposal_templates (name, description, category, opportunity_type, sections, status, version, tags, created_by, approved_by, approved_at)
SELECT * FROM (VALUES

  (
    'SAP S/4HANA Implementation – Rise',
    'Full lifecycle proposal template for SAP S/4HANA Rise with SAP cloud implementation. Covers Activate methodology, resource plan, commercials and legal.',
    'SAP Implementation',
    'SAP Implementation – Rise',
    '[
      {"id":"1","title":"Cover Page","description":"Project title, client name, AIS logo, date, confidentiality notice","required":true},
      {"id":"2","title":"Executive Summary","description":"High-level overview: client context, proposed solution, key value proposition","required":true},
      {"id":"3","title":"Client Context & Challenges","description":"Current state analysis, pain points, digital transformation objectives","required":true},
      {"id":"4","title":"Understanding of Requirements","description":"Detailed interpretation of RFP/RFQ requirements and client objectives","required":true},
      {"id":"5","title":"Proposed Solution","description":"SAP S/4HANA Rise architecture, modules in scope, integration landscape","required":true},
      {"id":"6","title":"Implementation Methodology","description":"SAP Activate phases: Discover, Prepare, Explore, Realize, Deploy, Run","required":true},
      {"id":"7","title":"Project Plan & Timeline","description":"Phase-wise milestones, Gantt chart summary, go-live date","required":true},
      {"id":"8","title":"Team Structure","description":"Proposed team composition, roles, offshore/onsite model","required":true},
      {"id":"9","title":"Commercial Proposal","description":"Effort estimates, rate cards, total cost, payment milestones","required":true},
      {"id":"10","title":"Risk & Mitigation","description":"Key project risks and mitigation strategies","required":false},
      {"id":"11","title":"SLA & Hypercare Support","description":"Post go-live support model, SLA commitments","required":false},
      {"id":"12","title":"Company Credentials","description":"About AIS, SAP Gold Partner, key certifications, relevant case studies","required":false},
      {"id":"13","title":"Assumptions & Exclusions","description":"Key assumptions, explicit exclusions from scope","required":true},
      {"id":"14","title":"Annexures","description":"CVs, legal terms, NDA, additional documents","required":false}
    ]'::jsonb,
    'Approved', '1.0',
    ARRAY['Rise','S/4HANA','Cloud','Fixed Price'],
    'System', 'System', NOW()
  ),

  (
    'SAP AMS Support Proposal',
    'Application Management Services proposal template. Suitable for T&M and retainer-based AMS engagements covering functional and technical support.',
    'AMS',
    'AMS',
    '[
      {"id":"1","title":"Cover Page","description":"Project title, client name, date, confidentiality","required":true},
      {"id":"2","title":"Executive Summary","description":"AMS engagement overview and key value proposition","required":true},
      {"id":"3","title":"Scope of Support","description":"Modules in scope, ticket categories (P1-P4), inclusions and exclusions","required":true},
      {"id":"4","title":"Service Delivery Model","description":"Offshore/onsite ratio, shift coverage, escalation matrix","required":true},
      {"id":"5","title":"Team Structure","description":"Support team composition, lead consultant roles","required":true},
      {"id":"6","title":"SLA Framework","description":"Response and resolution SLAs by priority, measurement and reporting","required":true},
      {"id":"7","title":"Transition Plan","description":"Knowledge transfer, shadowing, steady state timeline","required":true},
      {"id":"8","title":"Commercial Proposal","description":"Monthly retainer / T&M rates, billing model, payment terms","required":true},
      {"id":"9","title":"Governance & Reporting","description":"Monthly review cadence, KPI dashboard, escalation process","required":false},
      {"id":"10","title":"Company Credentials","description":"AMS track record, client references, certifications","required":false},
      {"id":"11","title":"Assumptions & Exclusions","description":"Scope boundaries, client responsibilities","required":true},
      {"id":"12","title":"Annexures","description":"Rate cards, legal terms, tool access requirements","required":false}
    ]'::jsonb,
    'Approved', '1.0',
    ARRAY['AMS','Support','T&M','Retainer'],
    'System', 'System', NOW()
  ),

  (
    'Resource Augmentation Proposal',
    'Staff augmentation proposal for providing SAP-skilled resources on a T&M basis. Covers resource profiles, rates, and engagement terms.',
    'General',
    'Resource Augmentation',
    '[
      {"id":"1","title":"Cover Page","description":"Engagement title, client name, date","required":true},
      {"id":"2","title":"Executive Summary","description":"Brief overview of augmentation engagement and AIS capabilities","required":true},
      {"id":"3","title":"Understanding of Requirement","description":"Skill requirements, number of resources, duration, expected outcomes","required":true},
      {"id":"4","title":"Proposed Resource Profiles","description":"CVs, skills, SAP certifications, relevant experience for each resource","required":true},
      {"id":"5","title":"Engagement Model","description":"Onsite/remote model, reporting structure, working hours","required":true},
      {"id":"6","title":"Commercial Proposal","description":"Rate per resource, billing cycle, PO terms","required":true},
      {"id":"7","title":"Replacement & Continuity","description":"Policy on resource replacement, knowledge continuity","required":false},
      {"id":"8","title":"Company Credentials","description":"About AIS, talent pool size, deployment track record","required":false},
      {"id":"9","title":"Assumptions & Exclusions","description":"Key assumptions, exclusions","required":true},
      {"id":"10","title":"Annexures","description":"Detailed CVs, legal terms","required":false}
    ]'::jsonb,
    'Approved', '1.0',
    ARRAY['Augmentation','Staff','T&M','Resources'],
    'System', 'System', NOW()
  ),

  (
    'SAP BTP / AI Innovation Proposal',
    'Proposal template for SAP BTP and AI/ML engagements. Covers use case definition, BTP architecture, AI model approach and commercial terms.',
    'BTP / AI',
    'BTP / AI',
    '[
      {"id":"1","title":"Cover Page","description":"Project title, client name, date, classification","required":true},
      {"id":"2","title":"Executive Summary","description":"Innovation opportunity, proposed BTP/AI solution, business value","required":true},
      {"id":"3","title":"Use Case Definition","description":"Business problem, AI/automation opportunity, success metrics","required":true},
      {"id":"4","title":"Solution Architecture","description":"BTP services, AI Core, integration with S/4HANA, data flows","required":true},
      {"id":"5","title":"Implementation Approach","description":"Agile delivery, sprint plan, PoC to production pathway","required":true},
      {"id":"6","title":"Data & AI Strategy","description":"Data sources, model training approach, governance","required":true},
      {"id":"7","title":"Team Structure","description":"BTP architects, AI/ML engineers, functional consultants","required":true},
      {"id":"8","title":"Commercial Proposal","description":"Phase-wise pricing, PoC pricing, ongoing support model","required":true},
      {"id":"9","title":"Risk & Governance","description":"AI ethics, data privacy, change management","required":false},
      {"id":"10","title":"Company Credentials","description":"BTP delivery track record, AI use cases delivered","required":false},
      {"id":"11","title":"Assumptions & Exclusions","description":"Data availability assumptions, out of scope items","required":true},
      {"id":"12","title":"Annexures","description":"Technical specs, legal terms","required":false}
    ]'::jsonb,
    'Approved', '1.0',
    ARRAY['BTP','AI','Innovation','Cloud'],
    'System', 'System', NOW()
  ),

  (
    'Government Tender Response',
    'Tender/RFP response template for government SAP engagements. Includes mandatory compliance sections, GeM/GFR requirements, and L1 pricing format.',
    'Tender',
    'Tender',
    '[
      {"id":"1","title":"Cover Letter","description":"Formal cover letter, authorised signatory, tender reference number","required":true},
      {"id":"2","title":"Executive Summary","description":"Overview of AIS, proposed solution, compliance statement","required":true},
      {"id":"3","title":"Company Profile","description":"About AIS, incorporation details, SAP partnership, financial standing","required":true},
      {"id":"4","title":"Technical Compliance Matrix","description":"Point-by-point response to technical requirements in the RFP","required":true},
      {"id":"5","title":"Understanding of Scope","description":"Scope interpretation, phased delivery plan","required":true},
      {"id":"6","title":"Proposed Solution","description":"Technical solution, SAP modules, architecture","required":true},
      {"id":"7","title":"Implementation Methodology","description":"SAP Activate, PRINCE2 or as required by tender","required":true},
      {"id":"8","title":"Project Plan","description":"Detailed timeline, milestones, resource deployment schedule","required":true},
      {"id":"9","title":"Team Profiles","description":"CVs of key personnel, minimum qualification compliance","required":true},
      {"id":"10","title":"Commercial Bid (BoQ)","description":"Bill of Quantities, L1 pricing format, taxes, payment schedule","required":true},
      {"id":"11","title":"Past Performance","description":"Similar government projects, completion certificates, references","required":true},
      {"id":"12","title":"Compliance Declarations","description":"Integrity pact, GeM/GFR declarations, self-certification","required":true},
      {"id":"13","title":"Annexures","description":"EMD/Bid security, power of attorney, legal documents","required":true}
    ]'::jsonb,
    'Approved', '1.0',
    ARRAY['Tender','Government','GeM','Fixed Price'],
    'System', 'System', NOW()
  )

) AS v(name, description, category, opportunity_type, sections, status, version, tags, created_by, approved_by, approved_at)
WHERE NOT EXISTS (
  SELECT 1 FROM public.proposal_templates WHERE proposal_templates.name = v.name
);
