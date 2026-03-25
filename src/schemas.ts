/**
 * Document Schema Definitions
 *
 * Each schema describes:
 *  • Fields a document contains (private)
 *  • Claims that can be proven about those fields (public outputs)
 */

// ── Schema type registry ────────────────────────────────────────────────────

export type SchemaType =
    | 'academic_credential'
    | 'income_statement'
    | 'medical_record'
    | 'property_deed'
    | 'identity_document';

export const SCHEMA_TYPES: SchemaType[] = [
    'academic_credential',
    'income_statement',
    'medical_record',
    'property_deed',
    'identity_document',
];

// ── Field definitions ───────────────────────────────────────────────────────

export interface FieldDef {
    label:        string;
    type:         'string' | 'number' | 'boolean' | 'string_array' | 'date' | 'enum';
    placeholder?: string;
    values?:      string[];   // for enum
    optional?:    boolean;
    min?:         number;
    max?:         number;
}

// ── Claim definitions ───────────────────────────────────────────────────────

export interface ClaimParam {
    name:         string;
    type:         'string' | 'number' | 'enum';
    label:        string;
    placeholder?: string;
    values?:      string[];
}

export interface ClaimDef {
    label:       string;
    description: string;
    params:      ClaimParam[];
    /** Short template for the human-readable proof description, e.g. "Has a {degree_type} in {field}" */
    template:    string;
}

// ── Schema definition ───────────────────────────────────────────────────────

export interface SchemaDefinition {
    label:       string;
    description: string;
    icon:        string;
    accentColor: string;
    fields:      Record<string, FieldDef>;
    claims:      Record<string, ClaimDef>;
}

// ── All schemas ─────────────────────────────────────────────────────────────

export const SCHEMAS: Record<SchemaType, SchemaDefinition> = {

    academic_credential: {
        label:       'Academic Credential',
        description: 'University degrees, diplomas, certificates',
        icon:        '🎓',
        accentColor: '#6366f1',
        fields: {
            institution:      { label: 'Institution Name',  type: 'string',  placeholder: 'MIT' },
            degree_type:      { label: 'Degree Type',       type: 'enum',    values: ['Associate', 'Bachelor', 'Master', 'PhD', 'Certificate'] },
            field_of_study:   { label: 'Field of Study',    type: 'string',  placeholder: 'Computer Science' },
            graduation_year:  { label: 'Graduation Year',   type: 'number',  placeholder: '2022', min: 1900, max: 2100 },
            accredited:       { label: 'Accredited Institution', type: 'boolean' },
            gpa:              { label: 'GPA',               type: 'number',  placeholder: '3.8', min: 0, max: 4, optional: true },
        },
        claims: {
            has_degree_in: {
                label:       'Has Degree in Field',
                description: 'Prove you hold a degree in a specified field without revealing which institution.',
                params:      [{ name: 'field', type: 'string', label: 'Required Field', placeholder: 'Computer Science' }],
                template:    'Holds a degree in {field}',
            },
            graduated_from_accredited: {
                label:       'Graduated from Accredited Institution',
                description: 'Prove your degree is from a regionally accredited institution.',
                params:      [],
                template:    'Graduated from an accredited institution',
            },
            degree_level_at_least: {
                label:       'Degree Level At Least',
                description: 'Prove you hold at minimum a Bachelor\'s, Master\'s, or PhD.',
                params:      [{ name: 'min_level', type: 'enum', label: 'Minimum Level', values: ['Associate', 'Bachelor', 'Master', 'PhD'] }],
                template:    'Holds at least a {min_level}\'s degree',
            },
            gpa_above: {
                label:       'GPA Above Threshold',
                description: 'Prove your GPA exceeds a threshold without revealing the exact value.',
                params:      [{ name: 'threshold', type: 'number', label: 'Minimum GPA', placeholder: '3.0' }],
                template:    'GPA is above {threshold}',
            },
        },
    },

    income_statement: {
        label:       'Income Statement',
        description: 'Pay stubs, tax returns, employment income documentation',
        icon:        '💰',
        accentColor: '#10b981',
        fields: {
            annual_income:    { label: 'Annual Income (USD)', type: 'number',  placeholder: '75000', min: 0 },
            employment_type:  { label: 'Employment Type',    type: 'enum',    values: ['Full-time', 'Part-time', 'Self-employed', 'Contract', 'Freelance'] },
            year:             { label: 'Tax / Fiscal Year',  type: 'number',  placeholder: '2024', min: 2000, max: 2100 },
            employer_name:    { label: 'Employer Name',      type: 'string',  placeholder: 'Acme Corp', optional: true },
        },
        claims: {
            income_above: {
                label:       'Income Exceeds Threshold',
                description: 'Prove annual income exceeds a threshold — perfect for rental and loan applications.',
                params:      [{ name: 'threshold', type: 'number', label: 'Minimum Income ($)', placeholder: '50000' }],
                template:    'Annual income exceeds ${threshold}',
            },
            is_employed: {
                label:       'Currently Employed',
                description: 'Prove full-time employment status without revealing employer or salary.',
                params:      [],
                template:    'Is currently employed',
            },
            income_in_range: {
                label:       'Income Within Range',
                description: 'Prove income falls within a specified bracket.',
                params:      [
                    { name: 'min', type: 'number', label: 'Range Minimum ($)', placeholder: '40000' },
                    { name: 'max', type: 'number', label: 'Range Maximum ($)', placeholder: '100000' },
                ],
                template:    'Income is between ${min} and ${max}',
            },
            income_above_x_times_rent: {
                label:       'Income ≥ 3× Monthly Rent',
                description: 'Prove the standard rental qualification (income ≥ 3× monthly rent).',
                params:      [{ name: 'monthly_rent', type: 'number', label: 'Monthly Rent ($)', placeholder: '2000' }],
                template:    'Income qualifies for ${monthly_rent}/mo rent (3× rule)',
            },
        },
    },

    medical_record: {
        label:       'Medical Record',
        description: 'Vaccination records, allergy reports, health certificates',
        icon:        '🏥',
        accentColor: '#f59e0b',
        fields: {
            vaccinations:     { label: 'Vaccinations (comma-separated)', type: 'string_array', placeholder: 'COVID-19, Influenza, Hepatitis B' },
            allergies:        { label: 'Known Allergies (comma-separated)', type: 'string_array', placeholder: 'Penicillin, Peanuts', optional: true },
            conditions:       { label: 'Medical Conditions (comma-separated)', type: 'string_array', placeholder: 'None', optional: true },
            blood_type:       { label: 'Blood Type', type: 'enum', values: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'], optional: true },
        },
        claims: {
            vaccinated_for: {
                label:       'Vaccinated for Disease',
                description: 'Prove vaccination for a specific disease without exposing full medical history.',
                params:      [{ name: 'disease', type: 'string', label: 'Disease / Vaccine', placeholder: 'COVID-19' }],
                template:    'Vaccinated for {disease}',
            },
            no_known_allergies: {
                label:       'No Known Allergies',
                description: 'Prove you have no recorded allergies.',
                params:      [],
                template:    'Has no known allergies',
            },
            allergy_free_of: {
                label:       'Free of Specific Allergen',
                description: 'Prove you are not allergic to a specific substance.',
                params:      [{ name: 'allergen', type: 'string', label: 'Allergen', placeholder: 'Penicillin' }],
                template:    'Not allergic to {allergen}',
            },
            medically_fit: {
                label:       'Medically Fit (No Conditions)',
                description: 'Prove no active medical conditions are recorded.',
                params:      [],
                template:    'No active medical conditions on record',
            },
        },
    },

    property_deed: {
        label:       'Property Deed',
        description: 'Real estate ownership, title, and valuation documents',
        icon:        '🏠',
        accentColor: '#8b5cf6',
        fields: {
            assessed_value:   { label: 'Assessed Value ($)', type: 'number', placeholder: '450000', min: 0 },
            purchase_year:    { label: 'Purchase Year',      type: 'number', placeholder: '2019', min: 1800, max: 2100 },
            property_type:    { label: 'Property Type',      type: 'enum',   values: ['Residential', 'Commercial', 'Land', 'Mixed-use', 'Industrial'] },
            property_address: { label: 'Property Address',   type: 'string', placeholder: '123 Main St, City, State', optional: true },
        },
        claims: {
            is_property_owner: {
                label:       'Is Property Owner',
                description: 'Prove you own documented real property.',
                params:      [],
                template:    'Is a verified property owner',
            },
            property_value_above: {
                label:       'Property Value Exceeds Threshold',
                description: 'Prove assessed property value exceeds a minimum without revealing exact value.',
                params:      [{ name: 'threshold', type: 'number', label: 'Minimum Value ($)', placeholder: '200000' }],
                template:    'Property assessed above ${threshold}',
            },
            purchased_before: {
                label:       'Property Owned Since Year',
                description: 'Prove you have owned property since at least a given year.',
                params:      [{ name: 'year', type: 'number', label: 'Owned Since Year', placeholder: '2020' }],
                template:    'Owned property since {year} or earlier',
            },
        },
    },

    identity_document: {
        label:       'Identity Document',
        description: 'Passport, national ID, driver\'s licence',
        icon:        '🪪',
        accentColor: '#ef4444',
        fields: {
            full_name:       { label: 'Full Name',         type: 'string', placeholder: 'Jane Doe' },
            date_of_birth:   { label: 'Date of Birth',     type: 'date',   placeholder: '1990-01-15' },
            nationality:     { label: 'Nationality',       type: 'string', placeholder: 'American' },
            document_type:   { label: 'Document Type',     type: 'enum',   values: ['Passport', 'National ID', "Driver's Licence", 'Residence Permit'] },
        },
        claims: {
            is_adult: {
                label:       'Is Adult (18+)',
                description: 'Prove you are 18 years of age or older without revealing birthdate.',
                params:      [],
                template:    'Is 18 years of age or older',
            },
            age_above: {
                label:       'Age Above Threshold',
                description: 'Prove age exceeds a threshold (e.g. 21+, 65+).',
                params:      [{ name: 'threshold', type: 'number', label: 'Minimum Age', placeholder: '21' }],
                template:    'Is {threshold} years of age or older',
            },
            nationality_is: {
                label:       'Nationality Match',
                description: 'Prove citizenship of a specific country.',
                params:      [{ name: 'country', type: 'string', label: 'Country', placeholder: 'American' }],
                template:    'Is a {country} national',
            },
        },
    },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

export function getSchema(type: SchemaType): SchemaDefinition {
    return SCHEMAS[type];
}

/** Render a claim template with its parameter values */
export function renderClaimDescription(
    schemaType: SchemaType,
    claimType:  string,
    params:     Record<string, unknown>
): string {
    const claim = SCHEMAS[schemaType]?.claims[claimType];
    if (!claim) return claimType;

    return claim.template.replace(/\{(\w+)\}/g, (_match, key: string) => {
        const val = params[key];
        return val !== undefined ? String(val) : `{${key}}`;
    });
}

/** Build a blank field values object for a schema (with defaults) */
export function buildBlankFields(schemaType: SchemaType): Record<string, unknown> {
    const schema = SCHEMAS[schemaType];
    const out: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(schema.fields)) {
        if (def.type === 'boolean')      out[key] = false;
        else if (def.type === 'string_array') out[key] = [];
        else if (def.type === 'enum' && def.values) out[key] = def.values[0];
        else                             out[key] = def.optional ? '' : '';
    }
    return out;
}
