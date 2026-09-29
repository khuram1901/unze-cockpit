-- Fix A: self-assigned task routing
-- Previously, when assigned_by_email = assigned_to_email (self-created task),
-- the route_submitted_task trigger would route the task back to the same person,
-- allowing them to immediately mark it Complete and bypassing manager sign-off.
-- Now: self-assigned tasks route to the submitter's manager_id chain instead.

CREATE OR REPLACE FUNCTION public.route_submitted_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  assigner       record;
  submitter      record;
  candidate      record;
  next_id        uuid;
  hop            int;
  is_self_assigned boolean;
BEGIN
  IF new.status = 'Submitted'
    AND (old.status IS DISTINCT FROM 'Submitted')
    AND coalesce(new.requires_manager_signoff, true)
  THEN
    IF old.assigned_by_email IS NOT NULL THEN

      is_self_assigned := lower(old.assigned_by_email) = lower(old.assigned_to_email);

      IF is_self_assigned THEN
        SELECT id, name, email, department, business_unit, is_active, manager_id
        INTO submitter
        FROM public.members
        WHERE lower(email) = lower(old.assigned_to_email);

        next_id := submitter.manager_id;
        assigner := null;
        hop := 0;
        WHILE next_id IS NOT NULL AND hop < 10 LOOP
          hop := hop + 1;
          SELECT id, name, email, department, business_unit, is_active, manager_id
          INTO candidate
          FROM public.members WHERE id = next_id;

          IF candidate.email IS NULL THEN
            next_id := null;
          ELSIF candidate.is_active IS NOT DISTINCT FROM true THEN
            assigner := candidate;
            next_id := null;
          ELSE
            next_id := candidate.manager_id;
          END IF;
        END LOOP;

      ELSE
        SELECT id, name, email, department, business_unit, is_active, manager_id
        INTO assigner
        FROM public.members
        WHERE lower(email) = lower(old.assigned_by_email);

        IF assigner.id IS NOT NULL AND assigner.is_active IS NOT DISTINCT FROM true THEN
          NULL;
        ELSE
          next_id := assigner.manager_id;
          assigner := null;
          hop := 0;
          WHILE next_id IS NOT NULL AND hop < 10 LOOP
            hop := hop + 1;
            SELECT id, name, email, department, business_unit, is_active, manager_id
            INTO candidate
            FROM public.members WHERE id = next_id;

            IF candidate.email IS NULL THEN
              next_id := null;
            ELSIF candidate.is_active IS NOT DISTINCT FROM true THEN
              assigner := candidate;
              next_id := null;
            ELSE
              next_id := candidate.manager_id;
            END IF;
          END LOOP;
        END IF;
      END IF;

      IF assigner.email IS NOT NULL THEN
        DELETE FROM public.task_assignees WHERE task_id = new.id;
        INSERT INTO public.task_assignees (task_id, member_id, member_name, member_email)
          VALUES (new.id, assigner.id, assigner.name, assigner.email);

        new.assigned_to               := assigner.name;
        new.assigned_to_email         := assigner.email;
        new.assigned_to_department    := assigner.department;
        new.assigned_to_business_unit := assigner.business_unit;
        new.assigned_by               := old.assigned_to;
        new.assigned_by_email         := old.assigned_to_email;
        new.submitted_by_name         := old.assigned_to;
        new.submitted_by_email        := old.assigned_to_email;
      END IF;

    END IF;
  END IF;

  RETURN new;
END;
$$;
