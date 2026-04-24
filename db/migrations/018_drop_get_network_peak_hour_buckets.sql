-- Видалення агрегації «пікові години по всій мережі» (розділ прибрано з аналітики адміна станцій).
DROP FUNCTION IF EXISTS getnetworkpeakhourbuckets(timestamptz, timestamptz);
