import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { createHandler } from "./handler.ts";
Deno.serve(createHandler(createClient, key => Deno.env.get(key)));
