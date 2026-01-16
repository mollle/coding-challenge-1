keine "elaborate valiadtion", aber ein bisschen wahrsch schon gut
500 mit feedback das z.b. db down? was ist üblich in prod. da nur roboter sachen dahinsteckt spricht das eher fpr wenig verbose
logging mit pino
id generierung in db, hash, uuid, auto increment?
beim ausführen von npm ci: 
npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful. 

nochmal checekn was als prod ready heißt und best practices sind
insert duration sichergehen das es 0.XXXXXX format ist

sciehrgeehen das
duration of the calculation in seconds und nicht noch mehr/weniger zeit ind er berechnung ist

table name executions stimmt?

Think about structure, readability, maintainability, performance, re-usability
and test-ability of the code. Like the solution is going to be deployed into the
production environment. You should be proud of what you deliver

wie gehe ich mit worst case um, das roboter alle felder cleaned aber mit einzelnen schritten, das wäre dann riesige json und rieseiges set

id für db entry
n klassischen relationalen Systemen und vielen Microservices mit Postgres:

- BIGINT IDENTITY / BIGSERIAL ist der Standard.

interview prep lesen