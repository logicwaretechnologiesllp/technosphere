-- Migration: Fix column name in leads table from expected_credit_terms to expected_credit
-- Ensures full compatibility with UI forms and actions

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'leads' 
    AND column_name = 'expected_credit_terms'
  ) THEN
    ALTER TABLE public.leads RENAME COLUMN expected_credit_terms TO expected_credit;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'leads' 
    AND column_name = 'expected_credit'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN expected_credit TEXT;
  END IF;
END $$;

-- Update status check constraint to include all valid statuses
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_status_check 
  CHECK (status IN ('draft', 'ready_to_send', 'sent', 'quoted', 'completed', 'cancelled', 'lost', 'won'));

