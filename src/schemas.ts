/**
 * Academic credential schema — form metadata for the Issue tab and the
 * claim catalog for the Prove tab. The four claims map 1:1 onto the
 * contract's prove* circuits.
 */

import { DEGREE_LEVELS } from './config';
import type { CertificateFields } from './midnight/encoding';
import type { ClaimKey } from './midnight/encoding';

// ── Form fields ──────────────────────────────────────────────────────────────

export interface FieldDef {
    label:        string;
    type:         'string' | 'number' | 'boolean' | 'enum';
    placeholder?: string;
    values?:      readonly string[];
    optional?:    boolean;
    min?:         number;
    max?:         number;
    step?:        number;
}

export const CERT_FORM_FIELDS: Record<keyof CertificateFields, FieldDef> = {
    studentName:    { label: 'Student Full Name',      type: 'string',  placeholder: 'Jane Doe' },
    studentId:      { label: 'Student ID / Passport',  type: 'string',  placeholder: 'STU-2024-1234' },
    institution:    { label: 'Institution Name',       type: 'string',  placeholder: 'Istanbul Technical University' },
    degreeType:     { label: 'Degree Level',           type: 'enum',    values: DEGREE_LEVELS },
    fieldOfStudy:   { label: 'Field of Study',         type: 'string',  placeholder: 'Computer Engineering' },
    graduationYear: { label: 'Graduation Year',        type: 'number',  placeholder: '2025', min: 1900, max: 2100, step: 1 },
    accredited:     { label: 'Accredited Institution', type: 'boolean' },
    gpa:            { label: 'GPA (0–4 scale)',        type: 'number',  placeholder: '3.62', min: 0, max: 4, step: 0.01, optional: true },
};

// ── Claims ───────────────────────────────────────────────────────────────────

export interface ClaimParam {
    name:         string;
    type:         'string' | 'number' | 'enum';
    label:        string;
    placeholder?: string;
    values?:      readonly string[];
}

export interface ClaimDef {
    label:       string;
    description: string;
    params:      ClaimParam[];
}

export const CLAIMS: Record<ClaimKey, ClaimDef> = {
    has_degree_in: {
        label:       'Has Degree in Field',
        description: 'Prove the certificate is for a specific field of study (exact match, case-insensitive) — institution, GPA and everything else stay private.',
        params: [{ name: 'field', type: 'string', label: 'Required Field of Study', placeholder: 'Computer Engineering' }],
    },
    graduated_from_accredited: {
        label:       'Graduated from Accredited Institution',
        description: 'Prove the issuing institution is accredited without revealing which one.',
        params: [],
    },
    degree_level_at_least: {
        label:       'Degree Level At Least',
        description: 'Prove the degree is at minimum a given level without revealing the exact degree.',
        params: [{ name: 'min_level', type: 'enum', label: 'Minimum Level', values: DEGREE_LEVELS.slice(1) }],
    },
    gpa_above: {
        label:       'GPA Above Threshold',
        description: 'Prove the GPA exceeds a threshold without revealing the exact value.',
        params: [{ name: 'threshold', type: 'number', label: 'Minimum GPA', placeholder: '3.0' }],
    },
};

export const CLAIM_KEYS = Object.keys(CLAIMS) as ClaimKey[];
