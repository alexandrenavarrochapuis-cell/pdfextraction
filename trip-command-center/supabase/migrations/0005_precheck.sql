-- TSA PreCheck indicator read from boarding passes (true, false, or unknown).

alter table public.boarding_passes add column tsa_precheck boolean;
