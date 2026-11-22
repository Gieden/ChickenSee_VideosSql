BEGIN TRANSACTION;
CREATE TABLE bird_hourly_behavior (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                hour_slot TEXT NOT NULL,
                track_id INTEGER NOT NULL,
                bird_label TEXT NOT NULL,
                bird_type TEXT NOT NULL,
                feeding_sec REAL NOT NULL,
                drinking_sec REAL NOT NULL,
                active_sec REAL NOT NULL,
                resting_sec REAL NOT NULL,
                agitated_sec REAL NOT NULL,
                feeding_bouts INTEGER NOT NULL,
                drinking_bouts INTEGER NOT NULL,
                avg_velocity_px_s REAL NOT NULL,
                lethargic_alert INTEGER NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
INSERT INTO "bird_hourly_behavior" VALUES(1,'2026-10-13','20:00 - 21:00',1,'Hen2 (White)','hen',5.2,0.0,0.0,0.0,0.0,1,0,51.19,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(2,'2026-10-13','20:00 - 21:00',2,'Chicken','hen',0.0,0.0,5.2,0.1,0.0,0,0,12.04,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(3,'2026-10-13','20:00 - 21:00',3,'Hen2 (White)','hen',0.0,0.0,5.7,0.1,0.0,0,0,8.3,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(4,'2026-10-13','20:00 - 21:00',4,'Hen2 (White)','hen',0.0,0.0,0.0,0.1,0.0,0,0,0.0,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(5,'2026-10-13','20:00 - 21:00',5,'Chicken','hen',5.8,0.0,0.0,0.0,0.0,1,0,5.77,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(6,'2026-10-13','20:00 - 21:00',6,'Chicken','hen',6.5,0.0,0.0,0.0,0.0,1,0,25.67,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(7,'2026-10-13','20:00 - 21:00',7,'Chicken','hen',5.5,0.0,0.0,0.0,0.0,1,0,8.99,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(8,'2026-10-13','20:00 - 21:00',8,'Hen5 (Pink)','hen',0.0,0.0,5.1,0.1,0.0,0,0,15.36,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(9,'2026-10-13','20:00 - 21:00',9,'Chicken','hen',0.0,0.0,0.0,0.1,0.0,0,0,0.0,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(10,'2026-10-13','20:00 - 21:00',10,'Chicken','hen',0.0,0.0,0.0,0.3,0.0,0,0,0.0,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(11,'2026-10-13','20:00 - 21:00',11,'Hen2 (White)','hen',0.0,0.0,0.0,0.2,0.0,0,0,0.0,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(12,'2026-10-13','20:00 - 21:00',12,'Rooster','rooster',0.7,0.0,0.0,0.0,0.0,1,0,2.09,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(13,'2026-10-13','20:00 - 21:00',13,'Hen2 (White)','hen',0.7,0.0,0.0,0.0,0.0,1,0,25.09,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(14,'2026-10-13','20:00 - 21:00',14,'Hen2 (White)','hen',0.2,0.0,0.0,0.0,0.0,1,0,0.0,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(15,'2026-10-13','20:00 - 21:00',15,'Rooster','rooster',0.3,0.0,0.8,0.0,0.0,2,0,19.38,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(16,'2026-10-13','20:00 - 21:00',16,'Hen2 (White)','hen',0.0,0.0,0.0,0.2,0.7,0,0,491.53,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(17,'2026-10-13','20:00 - 21:00',17,'Hen2 (White)','hen',0.0,0.0,0.2,0.7,0.0,0,0,8.37,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(18,'2026-10-13','20:00 - 21:00',18,'Chicken','hen',0.1,0.0,0.3,0.5,0.0,1,0,41.98,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(19,'2026-10-13','20:00 - 21:00',19,'Hen5 (Pink)','hen',0.7,0.0,0.0,0.0,0.0,1,0,6.17,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(20,'2026-10-13','20:00 - 21:00',20,'Chicken','hen',0.0,0.0,0.4,0.5,0.0,0,0,11.22,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(21,'2026-10-13','20:00 - 21:00',21,'Hen5 (Pink)','hen',0.2,0.0,0.0,0.0,0.0,1,0,0.0,0,'2026-10-13 12:10:01');
INSERT INTO "bird_hourly_behavior" VALUES(22,'2026-10-13','20:00 - 21:00',1,'Hen2 (White)','hen',7.2,0.0,0.0,0.0,0.0,1,0,30.8,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(23,'2026-10-13','20:00 - 21:00',2,'Chicken','hen',0.0,0.0,7.1,0.1,0.0,0,0,9.04,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(24,'2026-10-13','20:00 - 21:00',3,'Hen2 (White)','hen',0.0,0.0,7.2,0.3,0.0,0,0,13.28,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(25,'2026-10-13','20:00 - 21:00',4,'Hen2 (White)','hen',0.0,0.0,0.0,0.1,0.0,0,0,0.0,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(26,'2026-10-13','20:00 - 21:00',5,'Chicken','hen',7.5,0.0,0.0,0.0,0.0,1,0,3.25,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(27,'2026-10-13','20:00 - 21:00',6,'Rooster','rooster',7.3,0.0,0.0,0.0,0.0,1,0,10.51,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(28,'2026-10-13','20:00 - 21:00',7,'Chicken','hen',7.1,0.0,0.0,0.0,0.0,1,0,17.68,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(29,'2026-10-13','20:00 - 21:00',8,'Hen5 (Pink)','hen',0.0,0.0,6.0,0.5,0.0,0,0,14.62,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(30,'2026-10-13','20:00 - 21:00',9,'Chicken','hen',0.0,0.0,0.0,0.3,0.0,0,0,0.0,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(31,'2026-10-13','20:00 - 21:00',10,'Chicken','hen',0.0,0.0,0.0,0.3,0.0,0,0,0.0,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(32,'2026-10-13','20:00 - 21:00',11,'Hen2 (White)','hen',0.0,0.0,0.0,0.2,0.0,0,0,0.0,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(33,'2026-10-13','20:00 - 21:00',12,'Rooster','rooster',0.3,0.0,0.0,0.0,0.0,1,0,2.94,0,'2026-10-13 12:12:32');
INSERT INTO "bird_hourly_behavior" VALUES(34,'2026-10-13','20:00 - 21:00',1,'Hen2 (White)','hen',7.2,0.0,0.0,0.0,0.0,1,0,28.97,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(35,'2026-10-13','20:00 - 21:00',2,'Chicken','hen',0.0,0.0,7.1,0.1,0.0,0,0,8.84,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(36,'2026-10-13','20:00 - 21:00',3,'Hen2 (White)','hen',0.0,0.0,7.5,0.1,0.0,0,0,12.76,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(37,'2026-10-13','20:00 - 21:00',4,'Hen2 (White)','hen',0.0,0.0,0.0,0.1,0.0,0,0,0.0,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(38,'2026-10-13','20:00 - 21:00',5,'Chicken','hen',7.5,0.0,0.0,0.0,0.0,1,0,3.08,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(39,'2026-10-13','20:00 - 21:00',6,'Rooster','rooster',7.4,0.0,0.0,0.0,0.0,1,0,10.4,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(40,'2026-10-13','20:00 - 21:00',7,'Chicken','hen',7.2,0.0,0.0,0.0,0.0,1,0,17.4,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(41,'2026-10-13','20:00 - 21:00',8,'Hen5 (Pink)','hen',0.0,0.0,6.1,0.7,0.0,0,0,14.13,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(42,'2026-10-13','20:00 - 21:00',9,'Chicken','hen',0.0,0.0,0.0,0.3,0.0,0,0,0.0,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(43,'2026-10-13','20:00 - 21:00',10,'Chicken','hen',0.0,0.0,0.0,0.3,0.0,0,0,0.0,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(44,'2026-10-13','20:00 - 21:00',11,'Hen2 (White)','hen',0.0,0.0,0.0,0.2,0.0,0,0,0.0,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(45,'2026-10-13','20:00 - 21:00',12,'Rooster','rooster',0.3,0.0,0.0,0.0,0.0,1,0,2.98,0,'2026-10-13 12:19:44');
INSERT INTO "bird_hourly_behavior" VALUES(46,'2026-10-13','20:00 - 21:00',1,'Hen2 (White)','hen',11.3,0.0,0.0,0.0,0.0,1,0,20.45,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(47,'2026-10-13','20:00 - 21:00',2,'Chicken','hen',0.0,0.0,10.5,0.6,0.0,0,0,5.96,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(48,'2026-10-13','20:00 - 21:00',3,'Hen2 (White)','hen',0.0,0.0,10.3,1.5,0.0,0,0,8.94,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(49,'2026-10-13','20:00 - 21:00',4,'Hen2 (White)','hen',0.0,0.0,0.0,0.1,0.0,0,0,0.0,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(50,'2026-10-13','20:00 - 21:00',5,'Chicken','hen',11.8,0.0,0.0,0.0,0.0,1,0,2.08,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(51,'2026-10-13','20:00 - 21:00',6,'Rooster','rooster',11.5,0.0,0.0,0.0,0.0,1,0,6.97,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(52,'2026-10-13','20:00 - 21:00',7,'Chicken','hen',11.0,0.0,0.0,0.0,0.0,1,0,11.65,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(53,'2026-10-13','20:00 - 21:00',8,'Hen5 (Pink)','hen',0.0,0.0,9.4,0.9,0.0,0,0,9.59,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(54,'2026-10-13','20:00 - 21:00',9,'Chicken','hen',0.0,0.0,0.0,0.5,0.0,0,0,0.0,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(55,'2026-10-13','20:00 - 21:00',10,'Chicken','hen',0.0,0.0,0.0,0.5,0.0,0,0,0.0,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(56,'2026-10-13','20:00 - 21:00',11,'Hen2 (White)','hen',0.0,0.0,0.0,0.2,0.0,0,0,0.0,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(57,'2026-10-13','20:00 - 21:00',12,'Rooster','rooster',0.7,0.0,0.0,0.0,0.0,1,0,2.13,0,'2026-10-13 12:36:47');
INSERT INTO "bird_hourly_behavior" VALUES(58,'2026-10-13','20:00 - 21:00',6,'Rooster','rooster',0.3,475.2,275.0,71.3,52.8,1,31,4.68,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(59,'2026-10-13','20:00 - 21:00',114,'Hen3 (Violet)','hen',14.0,281.7,25.7,1.4,8.1,1,21,13.63,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(60,'2026-10-13','20:00 - 21:00',119,'Hen3 (Violet)','hen',334.2,0.0,33.8,1.4,64.0,20,0,4.35,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(61,'2026-10-13','20:00 - 21:00',147,'Hen3 (Violet)','hen',83.1,0.0,3.6,0.2,0.0,2,0,19.91,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(62,'2026-10-13','20:00 - 21:00',156,'Hen3 (Violet)','hen',0.0,72.7,13.4,16.5,0.6,0,8,53.84,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(63,'2026-10-13','20:00 - 21:00',160,'Hen5 (Pink)','hen',12.9,0.5,0.0,0.0,0.0,1,1,140.29,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(64,'2026-10-13','20:00 - 21:00',162,'Chicken','hen',0.0,0.0,0.2,0.2,0.0,0,0,16.14,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(65,'2026-10-13','20:00 - 21:00',163,'Hen2 (White)','hen',337.4,200.5,6.2,3.8,0.0,21,23,81.22,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(66,'2026-10-13','20:00 - 21:00',164,'Hen3 (Violet)','hen',0.0,0.0,0.4,0.1,0.0,0,0,5.18,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(67,'2026-10-13','20:00 - 21:00',165,'Chicken','hen',0.1,0.0,0.0,0.0,0.0,1,0,16.1,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(68,'2026-10-13','20:00 - 21:00',166,'Hen3 (Violet)','hen',0.0,0.0,1.1,0.1,0.0,0,0,9.18,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(69,'2026-10-13','20:00 - 21:00',167,'Chicken','hen',0.1,0.0,0.0,0.0,0.0,1,0,19.71,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(70,'2026-10-13','20:00 - 21:00',168,'Chicken','hen',0.1,0.0,0.0,0.0,0.0,1,0,11.97,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(71,'2026-10-13','20:00 - 21:00',169,'Chicken','hen',0.5,0.0,0.0,0.0,0.0,1,0,32.6,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(72,'2026-10-13','20:00 - 21:00',170,'Chicken','hen',0.0,0.3,0.0,0.0,0.0,0,1,7.74,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(73,'2026-10-13','20:00 - 21:00',171,'Chicken','hen',0.4,0.0,0.0,0.0,0.0,1,0,25.94,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(74,'2026-10-13','20:00 - 21:00',172,'Chicken','hen',0.3,0.0,0.0,0.0,0.0,1,0,3.01,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(75,'2026-10-13','20:00 - 21:00',173,'Hen3 (Violet)','hen',0.2,0.0,0.0,0.0,0.0,1,0,15.19,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(76,'2026-10-13','20:00 - 21:00',174,'Hen3 (Violet)','hen',2.3,0.0,0.0,0.0,0.0,1,0,8.63,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(77,'2026-10-13','20:00 - 21:00',175,'Chicken','hen',1.0,0.0,0.0,0.0,0.0,1,0,58.19,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(78,'2026-10-13','20:00 - 21:00',176,'Chicken','hen',1.3,0.0,0.0,0.0,0.0,1,0,1.98,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(79,'2026-10-13','20:00 - 21:00',177,'Hen3 (Violet)','hen',1.2,0.0,0.0,0.0,0.0,1,0,64.66,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(80,'2026-10-13','20:00 - 21:00',178,'Chicken','hen',0.6,0.0,0.0,0.0,0.0,1,0,15.57,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(81,'2026-10-13','20:00 - 21:00',179,'Chicken','hen',0.9,0.0,0.0,0.0,0.0,1,0,12.33,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(82,'2026-10-13','20:00 - 21:00',180,'Hen3 (Violet)','hen',2.1,0.0,0.0,0.0,0.0,1,0,8.38,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(83,'2026-10-13','20:00 - 21:00',181,'Chicken','hen',0.1,0.0,0.0,0.0,0.0,1,0,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(84,'2026-10-13','20:00 - 21:00',182,'Hen3 (Violet)','hen',0.7,0.0,0.0,0.0,0.0,1,0,16.04,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(85,'2026-10-13','20:00 - 21:00',183,'Rooster','rooster',0.0,0.0,0.0,0.1,0.0,0,0,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(86,'2026-10-13','20:00 - 21:00',184,'Chicken','hen',0.9,0.0,0.0,0.0,0.0,1,0,9.16,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(87,'2026-10-13','20:00 - 21:00',185,'Hen3 (Violet)','hen',0.0,0.5,0.0,0.0,0.0,0,1,4.18,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(88,'2026-10-13','20:00 - 21:00',186,'Hen3 (Violet)','hen',0.0,2.2,0.0,0.0,0.0,0,1,6.82,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(89,'2026-10-13','20:00 - 21:00',187,'Chicken','hen',0.0,0.0,0.1,0.1,0.0,0,0,6.27,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(90,'2026-10-13','20:00 - 21:00',188,'Chicken','hen',0.8,0.0,0.0,0.0,0.0,1,0,31.06,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(91,'2026-10-13','20:00 - 21:00',189,'Rooster','rooster',0.0,0.3,0.0,0.0,0.0,0,1,41.36,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(92,'2026-10-13','20:00 - 21:00',190,'Chicken','hen',0.0,0.1,0.0,0.0,0.0,0,1,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(93,'2026-10-13','20:00 - 21:00',191,'Rooster','rooster',0.0,1.3,0.0,0.0,0.0,0,1,15.85,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(94,'2026-10-13','20:00 - 21:00',192,'Rooster','rooster',0.0,1.1,0.0,0.0,0.0,0,1,4.01,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(95,'2026-10-13','20:00 - 21:00',193,'Chicken','hen',0.2,0.0,0.0,0.0,0.0,1,0,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(96,'2026-10-13','20:00 - 21:00',194,'Rooster','rooster',0.0,0.9,0.0,0.0,0.0,0,1,15.71,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(97,'2026-10-13','20:00 - 21:00',195,'Rooster','rooster',0.0,0.2,0.0,0.0,0.0,0,1,7.45,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(98,'2026-10-13','20:00 - 21:00',196,'Rooster','rooster',0.0,0.1,0.0,0.0,0.0,0,1,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(99,'2026-10-13','20:00 - 21:00',197,'Hen3 (Violet)','hen',0.0,0.9,0.0,0.0,0.0,0,1,9.19,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(100,'2026-10-13','20:00 - 21:00',198,'Hen3 (Violet)','hen',1.6,0.0,0.0,0.0,0.0,1,0,18.42,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(101,'2026-10-13','20:00 - 21:00',199,'Chicken','hen',3.0,0.0,0.0,0.0,0.0,1,0,4.69,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(102,'2026-10-13','20:00 - 21:00',200,'Hen3 (Violet)','hen',0.9,0.0,0.0,0.0,0.0,1,0,3.24,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(103,'2026-10-13','20:00 - 21:00',201,'Hen3 (Violet)','hen',0.0,2.0,0.0,0.0,0.0,0,1,4.28,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(104,'2026-10-13','20:00 - 21:00',202,'Hen5 (Pink)','hen',119.8,64.8,6.5,4.7,0.0,7,5,3.69,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(105,'2026-10-13','20:00 - 21:00',203,'Chicken','hen',0.0,0.4,0.0,0.0,0.0,0,1,3.76,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(106,'2026-10-13','20:00 - 21:00',204,'Chicken','hen',0.9,0.0,0.0,0.0,0.0,1,0,4.95,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(107,'2026-10-13','20:00 - 21:00',205,'Rooster','rooster',0.0,1.7,0.0,0.2,0.0,0,2,1.85,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(108,'2026-10-13','20:00 - 21:00',206,'Chicken','hen',0.2,0.0,0.0,0.0,0.0,1,0,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(109,'2026-10-13','20:00 - 21:00',207,'Rooster','rooster',0.0,1.3,0.0,0.0,0.0,0,1,2.61,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(110,'2026-10-13','20:00 - 21:00',208,'Chicken','hen',0.2,0.0,0.0,0.0,0.0,1,0,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(111,'2026-10-13','20:00 - 21:00',209,'Rooster','rooster',0.0,0.8,0.0,0.0,0.0,0,1,3.73,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(112,'2026-10-13','20:00 - 21:00',210,'Rooster','rooster',0.0,0.9,0.0,0.0,0.0,0,1,11.49,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(113,'2026-10-13','20:00 - 21:00',211,'Chicken','hen',1.6,0.0,0.0,0.0,0.0,1,0,17.27,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(114,'2026-10-13','20:00 - 21:00',212,'Hen3 (Violet)','hen',1.9,0.0,0.0,0.0,0.0,1,0,0.54,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(115,'2026-10-13','20:00 - 21:00',213,'Chicken','hen',0.0,0.2,0.0,0.0,0.0,0,1,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(116,'2026-10-13','20:00 - 21:00',214,'Chicken','hen',0.0,2.8,0.0,0.0,0.0,0,1,4.61,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(117,'2026-10-13','20:00 - 21:00',215,'Hen3 (Violet)','hen',0.0,0.4,0.0,0.0,0.0,0,1,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(118,'2026-10-13','20:00 - 21:00',216,'Hen3 (Violet)','hen',0.0,0.2,0.0,0.0,0.0,0,1,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(119,'2026-10-13','20:00 - 21:00',217,'Chicken','hen',8.1,0.0,0.0,2.7,0.0,2,0,3.03,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(120,'2026-10-13','20:00 - 21:00',218,'Hen3 (Violet)','hen',0.0,1.8,0.0,0.0,0.0,0,1,3.71,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(121,'2026-10-13','20:00 - 21:00',219,'Rooster','rooster',0.0,0.4,0.0,0.0,0.0,0,1,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(122,'2026-10-13','20:00 - 21:00',220,'Hen3 (Violet)','hen',0.0,5.2,0.0,0.0,0.0,0,1,20.78,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(123,'2026-10-13','20:00 - 21:00',221,'Rooster','rooster',0.0,0.4,0.0,0.0,0.0,0,1,4.95,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(124,'2026-10-13','20:00 - 21:00',222,'Chicken','hen',86.2,30.7,0.2,0.0,0.0,1,2,25.3,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(125,'2026-10-13','20:00 - 21:00',223,'Chicken','hen',0.0,2.4,0.0,0.0,0.0,0,1,4.35,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(126,'2026-10-13','20:00 - 21:00',224,'Chicken','hen',0.0,0.0,0.9,0.2,0.0,0,0,19.14,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(127,'2026-10-13','20:00 - 21:00',225,'Rooster','rooster',0.0,0.2,0.0,0.0,0.0,0,1,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(128,'2026-10-13','20:00 - 21:00',226,'Chicken','hen',4.3,0.0,0.0,0.0,0.0,1,0,3.96,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(129,'2026-10-13','20:00 - 21:00',227,'Chicken','hen',2.0,0.0,0.0,0.0,0.0,1,0,1.76,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(130,'2026-10-13','20:00 - 21:00',228,'Rooster','rooster',0.0,5.3,0.0,0.0,0.0,0,1,1.02,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(131,'2026-10-13','20:00 - 21:00',229,'Rooster','rooster',0.0,3.8,0.0,0.0,0.0,0,1,0.68,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(132,'2026-10-13','20:00 - 21:00',230,'Chicken','hen',9.8,0.0,0.0,0.0,0.0,1,0,5.04,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(133,'2026-10-13','20:00 - 21:00',231,'Rooster','rooster',0.0,0.4,0.0,0.0,0.0,0,1,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(134,'2026-10-13','20:00 - 21:00',232,'Rooster','rooster',0.0,13.8,0.0,0.2,0.0,0,2,3.46,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(135,'2026-10-13','20:00 - 21:00',233,'Chicken','hen',0.6,0.0,0.0,0.0,0.0,1,0,1.68,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(136,'2026-10-13','20:00 - 21:00',234,'Chicken','hen',1.1,0.0,0.0,0.0,0.0,1,0,5.43,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(137,'2026-10-13','20:00 - 21:00',235,'Chicken','hen',4.3,0.0,0.0,0.0,0.0,1,0,3.72,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(138,'2026-10-13','20:00 - 21:00',236,'Chicken','hen',2.0,0.0,0.0,0.0,0.0,1,0,1.67,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(139,'2026-10-13','20:00 - 21:00',237,'Chicken','hen',1.7,0.0,0.0,0.0,0.0,1,0,3.74,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(140,'2026-10-13','20:00 - 21:00',238,'Hen4 (Yellow)','hen',88.8,0.0,16.9,84.9,0.0,13,0,30.81,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(141,'2026-10-13','20:00 - 21:00',239,'Chicken','hen',1.7,0.0,0.0,0.0,0.0,1,0,6.99,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(142,'2026-10-13','20:00 - 21:00',240,'Rooster','rooster',0.0,7.5,0.0,0.0,0.0,0,1,1.08,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(143,'2026-10-13','20:00 - 21:00',241,'Chicken','hen',0.4,0.0,0.0,0.0,0.0,1,0,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(144,'2026-10-13','20:00 - 21:00',242,'Rooster','rooster',0.0,4.7,0.0,0.2,0.0,0,2,0.29,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(145,'2026-10-13','20:00 - 21:00',243,'Chicken','hen',2.1,0.0,0.0,0.0,0.0,1,0,3.91,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(146,'2026-10-13','20:00 - 21:00',244,'Chicken','hen',2.7,0.0,0.0,0.0,0.0,1,0,9.06,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(147,'2026-10-13','20:00 - 21:00',245,'Rooster','rooster',0.0,7.3,0.0,0.0,0.0,0,1,1.91,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(148,'2026-10-13','20:00 - 21:00',246,'Chicken','hen',4.6,0.0,0.0,0.0,0.0,1,0,12.94,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(149,'2026-10-13','20:00 - 21:00',247,'Chicken','hen',2.4,0.0,0.0,0.0,0.0,1,0,30.92,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(150,'2026-10-13','20:00 - 21:00',248,'Chicken','hen',0.6,0.0,0.0,0.0,0.0,1,0,26.14,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(151,'2026-10-13','20:00 - 21:00',249,'Rooster','rooster',0.0,1.0,0.0,0.0,0.0,0,1,3.07,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(152,'2026-10-13','20:00 - 21:00',250,'Chicken','hen',10.2,0.0,5.6,0.4,0.0,1,0,24.07,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(153,'2026-10-13','20:00 - 21:00',251,'Chicken','hen',0.8,0.0,0.0,0.0,0.0,1,0,7.65,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(154,'2026-10-13','20:00 - 21:00',252,'Chicken','hen',0.0,0.0,0.0,1.3,0.0,0,0,3.33,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(155,'2026-10-13','20:00 - 21:00',253,'Rooster','rooster',0.0,1.5,0.0,0.0,0.0,0,1,0.73,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(156,'2026-10-13','20:00 - 21:00',254,'Chicken','hen',8.3,0.0,0.0,0.0,0.0,1,0,5.47,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(157,'2026-10-13','20:00 - 21:00',255,'Rooster','rooster',0.0,0.0,0.0,0.4,0.0,0,0,2.56,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(158,'2026-10-13','20:00 - 21:00',256,'Rooster','rooster',0.0,1.4,0.0,0.0,0.0,0,1,3.58,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(159,'2026-10-13','20:00 - 21:00',257,'Hen3 (Violet)','hen',78.8,63.6,0.4,0.2,0.0,2,4,9.94,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(160,'2026-10-13','20:00 - 21:00',258,'Chicken','hen',0.0,0.0,0.0,1.9,0.0,0,0,1.94,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(161,'2026-10-13','20:00 - 21:00',259,'Rooster','rooster',0.0,0.8,0.0,0.0,0.0,0,1,5.14,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(162,'2026-10-13','20:00 - 21:00',260,'Chicken','hen',2.8,0.0,0.0,0.0,0.0,1,0,40.89,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(163,'2026-10-13','20:00 - 21:00',261,'Rooster','rooster',0.0,0.0,0.0,1.0,0.0,0,0,2.03,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(164,'2026-10-13','20:00 - 21:00',262,'Chicken','hen',15.8,0.0,0.0,0.0,0.0,1,0,38.58,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(165,'2026-10-13','20:00 - 21:00',263,'Chicken','hen',1.0,0.0,0.0,0.0,0.0,1,0,35.62,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(166,'2026-10-13','20:00 - 21:00',264,'Hen3 (Violet)','hen',106.9,0.0,0.0,0.5,0.0,2,0,10.41,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(167,'2026-10-13','20:00 - 21:00',265,'Chicken','hen',24.3,0.0,1.3,0.0,0.0,3,0,30.8,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(168,'2026-10-13','20:00 - 21:00',266,'Chicken','hen',0.0,0.4,0.0,0.0,0.0,0,1,2.43,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(169,'2026-10-13','20:00 - 21:00',267,'Chicken','hen',0.0,0.0,0.0,3.5,0.0,0,0,1.99,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(170,'2026-10-13','20:00 - 21:00',268,'Chicken','hen',0.0,3.2,0.0,0.0,0.0,0,1,30.91,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(171,'2026-10-13','20:00 - 21:00',269,'Chicken','hen',0.2,0.0,0.0,0.0,0.0,1,0,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(172,'2026-10-13','20:00 - 21:00',270,'Chicken','hen',0.0,4.4,0.0,0.0,0.0,0,1,1.83,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(173,'2026-10-13','20:00 - 21:00',271,'Chicken','hen',3.0,0.0,0.0,0.0,0.0,1,0,64.48,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(174,'2026-10-13','20:00 - 21:00',272,'Chicken','hen',0.9,0.0,0.0,0.0,0.0,1,0,2.84,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(175,'2026-10-13','20:00 - 21:00',273,'Chicken','hen',1.2,0.0,0.0,0.0,0.0,1,0,87.07,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(176,'2026-10-13','20:00 - 21:00',274,'Chicken','hen',0.0,0.0,0.0,0.6,0.0,0,0,1.79,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(177,'2026-10-13','20:00 - 21:00',275,'Chicken','hen',3.0,0.0,0.0,0.0,0.0,1,0,6.99,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(178,'2026-10-13','20:00 - 21:00',276,'Chicken','hen',4.9,0.0,0.0,0.0,0.0,1,0,26.52,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(179,'2026-10-13','20:00 - 21:00',277,'Chicken','hen',2.6,0.0,15.7,3.7,0.0,2,0,19.72,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(180,'2026-10-13','20:00 - 21:00',278,'Chicken','hen',0.3,0.0,0.0,4.6,0.0,1,0,1.21,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(181,'2026-10-13','20:00 - 21:00',279,'Rooster','rooster',0.0,4.4,0.0,0.0,0.0,0,1,5.51,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(182,'2026-10-13','20:00 - 21:00',280,'Rooster','rooster',0.0,2.0,0.0,0.0,0.0,0,1,1.03,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(183,'2026-10-13','20:00 - 21:00',281,'Chicken','hen',0.0,0.0,0.4,0.2,0.0,0,0,11.72,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(184,'2026-10-13','20:00 - 21:00',282,'Hen3 (Violet)','hen',99.1,0.0,17.1,22.3,0.0,6,0,2.39,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(185,'2026-10-13','20:00 - 21:00',283,'Rooster','rooster',0.0,0.3,0.0,0.0,0.0,0,1,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(186,'2026-10-13','20:00 - 21:00',284,'Chicken','hen',0.2,0.0,0.0,0.0,0.0,1,0,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(187,'2026-10-13','20:00 - 21:00',285,'Chicken','hen',0.4,0.0,0.0,0.0,0.0,1,0,3.77,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(188,'2026-10-13','20:00 - 21:00',286,'Chicken','hen',2.9,0.0,0.0,0.0,0.0,1,0,42.55,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(189,'2026-10-13','20:00 - 21:00',287,'Chicken','hen',0.0,0.0,0.0,1.6,0.0,0,0,1.23,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(190,'2026-10-13','20:00 - 21:00',288,'Chicken','hen',1.7,0.0,0.0,0.0,0.0,1,0,1.09,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(191,'2026-10-13','20:00 - 21:00',289,'Chicken','hen',0.5,0.0,0.0,0.0,0.0,1,0,2.03,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(192,'2026-10-13','20:00 - 21:00',290,'Chicken','hen',4.0,0.0,0.0,0.0,0.0,1,0,5.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(193,'2026-10-13','20:00 - 21:00',291,'Chicken','hen',0.0,0.0,0.4,0.4,0.0,0,0,6.17,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(194,'2026-10-13','20:00 - 21:00',292,'Chicken','hen',3.0,0.0,0.0,0.0,0.0,1,0,5.84,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(195,'2026-10-13','20:00 - 21:00',293,'Chicken','hen',2.1,0.0,0.0,0.0,0.0,1,0,1.96,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(196,'2026-10-13','20:00 - 21:00',294,'Chicken','hen',0.0,0.6,0.0,0.0,0.0,0,1,2.28,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(197,'2026-10-13','20:00 - 21:00',295,'Hen3 (Violet)','hen',45.3,0.0,0.3,1.2,0.0,6,0,38.88,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(198,'2026-10-13','20:00 - 21:00',296,'Hen5 (Pink)','hen',67.8,6.1,7.0,0.0,0.0,6,1,15.04,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(199,'2026-10-13','20:00 - 21:00',297,'Chicken','hen',2.1,0.0,0.0,0.0,0.0,1,0,4.77,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(200,'2026-10-13','20:00 - 21:00',298,'Chicken','hen',0.9,0.0,0.0,0.0,0.0,1,0,2.8,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(201,'2026-10-13','20:00 - 21:00',299,'Chicken','hen',2.6,0.0,0.0,0.0,0.0,1,0,9.36,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(202,'2026-10-13','20:00 - 21:00',300,'Chicken','hen',0.8,0.0,0.0,0.0,0.0,1,0,1.64,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(203,'2026-10-13','20:00 - 21:00',301,'Hen2 (White)','hen',18.5,24.1,0.7,0.0,0.0,1,2,17.45,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(204,'2026-10-13','20:00 - 21:00',302,'Chicken','hen',2.7,0.0,0.0,0.0,0.0,1,0,2.95,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(205,'2026-10-13','20:00 - 21:00',303,'Hen3 (Violet)','hen',3.4,34.8,0.0,0.0,0.0,1,1,7.07,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(206,'2026-10-13','20:00 - 21:00',304,'Chicken','hen',18.9,0.0,5.8,0.0,1.1,3,0,2.36,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(207,'2026-10-13','20:00 - 21:00',305,'Chicken','hen',0.0,0.0,0.0,0.7,0.0,0,0,2.97,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(208,'2026-10-13','20:00 - 21:00',306,'Chicken','hen',0.7,0.0,0.0,0.0,0.0,1,0,32.24,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(209,'2026-10-13','20:00 - 21:00',307,'Chicken','hen',2.3,0.0,0.0,0.0,0.0,1,0,18.63,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(210,'2026-10-13','20:00 - 21:00',308,'Chicken','hen',0.2,0.0,0.0,0.0,0.0,1,0,0.0,0,'2026-10-13 13:00:00');
INSERT INTO "bird_hourly_behavior" VALUES(211,'2026-10-13','20:00 - 21:00',309,'Chicken','hen',0.0,0.7,0.0,0.0,0.0,0,1,5.09,0,'2026-10-13 13:00:00');
CREATE TABLE edge_system_health (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                hour_slot TEXT NOT NULL,
                cpu_pct REAL NOT NULL,
                ram_mb REAL NOT NULL,
                fps REAL NOT NULL,
                status TEXT NOT NULL
            );
CREATE TABLE environmental_logs_raw (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                temperature_c REAL NOT NULL,
                humidity_pct REAL NOT NULL,
                ammonia_ppm REAL NOT NULL,
                lux REAL NOT NULL,
                thi REAL NOT NULL,
                heat_stress_level TEXT NOT NULL
            );
INSERT INTO "environmental_logs_raw" VALUES(1,'2026-10-13T20:09:59.378777',23.72,82.6,19.69,15.0,73.07,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(2,'2026-10-13T20:45:16.538130',24.03,81.3,20.94,15.0,73.45,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(3,'2026-10-13T20:45:20.569538',24.33,81.7,20.38,15.0,73.98,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(4,'2026-10-13T20:45:25.591573',24.12,81.5,20.34,15.0,73.61,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(5,'2026-10-13T20:45:29.614570',23.82,82.1,20.14,15.0,73.19,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(6,'2026-10-13T20:45:34.639656',23.85,82.9,22.06,15.0,73.32,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(7,'2026-10-13T20:45:38.671950',23.89,82.0,20.38,15.0,73.29,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(8,'2026-10-13T20:45:43.702045',23.83,81.9,21.6,15.0,73.18,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(9,'2026-10-13T20:45:48.736196',24.26,83.0,20.52,15.0,73.99,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(10,'2026-10-13T20:45:52.764611',23.83,81.3,22.05,15.0,73.12,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(11,'2026-10-13T20:45:56.794645',24.02,81.8,20.75,15.0,73.49,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(12,'2026-10-13T20:46:00.829561',23.88,81.4,20.49,15.0,73.23,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(13,'2026-10-13T20:46:04.855231',24.11,82.6,21.53,15.0,73.7,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(14,'2026-10-13T20:46:08.874035',24.24,82.0,20.81,15.0,73.87,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(15,'2026-10-13T20:46:12.899716',24.23,81.4,22.25,15.0,73.79,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(16,'2026-10-13T20:46:17.929877',24.4,82.6,21.09,15.0,74.17,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(17,'2026-10-13T20:46:21.965108',23.77,82.2,21.6,15.0,73.12,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(18,'2026-10-13T20:46:25.991312',24.03,81.2,22.35,15.0,73.45,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(19,'2026-10-13T20:46:31.015348',24.04,81.6,21.37,15.0,73.5,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(20,'2026-10-13T20:46:35.037031',23.8,81.8,21.69,15.0,73.13,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(21,'2026-10-13T20:46:39.072831',23.91,81.7,21.58,15.0,73.29,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(22,'2026-10-13T20:46:44.117095',24.3,81.0,20.65,15.0,73.86,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(23,'2026-10-13T20:46:48.153854',24.11,82.2,21.47,15.0,73.66,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(24,'2026-10-13T20:46:53.197276',23.62,82.2,22.1,15.0,72.87,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(25,'2026-10-13T20:46:57.212729',23.88,81.1,21.95,15.0,73.19,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(26,'2026-10-13T20:47:01.249074',24.29,82.9,21.89,15.0,74.03,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(27,'2026-10-13T20:47:05.265273',24.18,81.2,21.05,15.0,73.69,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(28,'2026-10-13T20:47:10.286160',24.36,81.9,21.23,15.0,74.04,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(29,'2026-10-13T20:47:14.313468',24.18,81.2,21.12,15.0,73.69,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(30,'2026-10-13T20:47:18.321434',23.68,81.1,21.44,15.0,72.87,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(31,'2026-10-13T20:47:22.346549',24.17,81.9,21.65,15.0,73.73,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(32,'2026-10-13T20:47:29.387077',23.9,81.3,20.69,15.0,73.24,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(33,'2026-10-13T20:47:40.472009',24.24,82.0,21.84,15.0,73.85,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(34,'2026-10-13T20:47:48.527358',23.91,81.3,21.71,15.0,73.25,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(35,'2026-10-13T20:47:52.554384',23.87,82.0,20.27,15.0,73.25,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(36,'2026-10-13T20:47:56.591502',24.36,81.7,20.61,15.0,74.02,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(37,'2026-10-13T20:48:00.607703',24.09,81.7,20.47,15.0,73.59,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(38,'2026-10-13T20:48:05.667836',23.6,82.1,21.42,15.0,72.84,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(39,'2026-10-13T20:48:09.700623',23.98,82.6,20.28,15.0,73.5,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(40,'2026-10-13T20:48:13.745124',23.63,82.7,21.41,15.0,72.93,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(41,'2026-10-13T20:48:17.764971',23.86,81.2,21.84,15.0,73.16,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(42,'2026-10-13T20:48:21.786678',24.14,81.3,20.52,15.0,73.64,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(43,'2026-10-13T20:48:25.807184',23.85,81.6,21.23,15.0,73.2,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(44,'2026-10-13T20:48:29.839951',23.81,81.7,21.43,15.0,73.14,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(45,'2026-10-13T20:48:33.854966',24.0,82.2,21.8,15.0,73.49,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(46,'2026-10-13T20:48:37.874036',23.65,83.0,20.56,15.0,73.0,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(47,'2026-10-13T20:48:41.905853',24.15,81.0,20.65,15.0,73.61,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(48,'2026-10-13T20:48:45.926665',23.75,81.6,21.46,15.0,73.03,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(49,'2026-10-13T20:48:49.959459',23.72,82.0,20.41,15.0,73.03,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(50,'2026-10-13T20:48:53.986844',24.08,81.6,21.83,15.0,73.56,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(51,'2026-10-13T20:48:58.003770',24.16,81.6,21.89,15.0,73.69,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(52,'2026-10-13T20:49:02.028753',23.84,82.0,20.27,15.0,73.21,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(53,'2026-10-13T20:49:05.052410',23.87,82.9,21.48,15.0,73.35,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(54,'2026-10-13T20:49:09.066918',24.21,81.2,22.05,15.0,73.74,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(55,'2026-10-13T20:49:13.079749',23.76,82.6,20.76,15.0,73.14,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(56,'2026-10-13T20:49:17.097742',23.6,82.3,20.56,15.0,72.85,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(57,'2026-10-13T20:49:21.121616',23.98,82.8,20.63,15.0,73.51,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(58,'2026-10-13T20:49:24.139749',24.24,81.5,20.21,15.0,73.8,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(59,'2026-10-13T20:49:28.168266',24.19,82.3,20.69,15.0,73.81,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(60,'2026-10-13T20:49:32.210140',23.89,81.5,21.1,15.0,73.24,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(61,'2026-10-13T20:49:36.233071',24.18,81.3,22.07,15.0,73.7,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(62,'2026-10-13T20:49:43.292156',24.11,82.5,21.19,15.0,73.7,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(63,'2026-10-13T20:49:51.367271',24.06,82.3,22.13,15.0,73.6,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(64,'2026-10-13T20:50:01.445553',23.81,81.0,20.37,15.0,73.08,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(65,'2026-10-13T20:50:05.476375',23.67,82.3,20.33,15.0,72.95,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(66,'2026-10-13T20:50:08.501027',23.93,82.7,21.26,15.0,73.43,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(67,'2026-10-13T20:50:12.522431',24.33,81.7,21.44,15.0,73.98,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(68,'2026-10-13T20:50:16.545322',23.68,82.9,22.52,15.0,73.04,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(69,'2026-10-13T20:50:20.576660',23.74,82.6,21.5,15.0,73.11,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(70,'2026-10-13T20:50:24.597467',24.38,81.5,21.07,15.0,74.04,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(71,'2026-10-13T20:50:28.637332',24.09,82.4,22.06,15.0,73.66,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(72,'2026-10-13T20:50:33.657882',24.09,82.3,22.36,15.0,73.66,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(73,'2026-10-13T20:50:38.687304',24.05,81.9,21.37,15.0,73.53,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(74,'2026-10-13T20:50:42.701220',24.29,81.2,21.51,15.0,73.86,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(75,'2026-10-13T20:50:47.733305',24.34,82.1,22.47,15.0,74.03,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(76,'2026-10-13T20:50:51.764814',23.95,82.8,21.46,15.0,73.47,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(77,'2026-10-13T20:50:56.800562',23.68,82.7,21.33,15.0,73.02,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(78,'2026-10-13T20:51:01.841885',23.88,82.7,20.22,15.0,73.34,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(79,'2026-10-13T20:51:08.882069',24.03,81.6,21.98,15.0,73.49,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(80,'2026-10-13T20:51:20.972301',23.88,82.0,20.57,15.0,73.28,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(81,'2026-10-13T20:51:33.086833',24.1,82.2,20.67,15.0,73.66,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(82,'2026-10-13T20:51:44.184775',24.22,81.3,20.61,15.0,73.75,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(83,'2026-10-13T20:51:56.285380',24.38,82.9,22.22,15.0,74.19,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(84,'2026-10-13T20:52:09.386382',23.73,81.2,21.15,15.0,72.95,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(85,'2026-10-13T20:52:21.439120',23.85,82.5,21.44,15.0,73.28,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(86,'2026-10-13T20:52:31.524423',23.72,82.6,21.95,15.0,73.08,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(87,'2026-10-13T20:52:43.628375',23.69,82.3,22.18,15.0,72.99,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(88,'2026-10-13T20:52:54.656896',23.72,82.1,21.68,15.0,73.03,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(89,'2026-10-13T20:53:02.684972',24.15,81.1,20.93,15.0,73.62,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(90,'2026-10-13T20:53:11.730411',23.63,81.6,20.52,15.0,72.84,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(91,'2026-10-13T20:53:22.792044',23.95,81.4,21.8,15.0,73.32,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(92,'2026-10-13T20:53:36.861090',24.37,81.8,20.26,15.0,74.06,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(93,'2026-10-13T20:53:48.930860',24.29,82.3,21.64,15.0,73.96,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(94,'2026-10-13T20:54:03.015669',23.9,81.3,21.68,15.0,73.24,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(95,'2026-10-13T20:54:15.106853',24.09,81.9,21.41,15.0,73.61,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(96,'2026-10-13T20:54:28.278139',24.36,81.3,21.62,15.0,73.98,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(97,'2026-10-13T20:54:40.367902',23.74,83.0,21.33,15.0,73.14,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(98,'2026-10-13T20:54:52.448011',24.3,82.9,21.23,15.0,74.05,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(99,'2026-10-13T20:55:04.515059',24.31,82.4,21.3,15.0,74.01,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(100,'2026-10-13T20:55:16.608302',24.14,81.3,21.71,15.0,73.63,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(101,'2026-10-13T20:55:28.686507',24.22,82.3,20.74,15.0,73.86,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(102,'2026-10-13T20:55:40.747557',24.33,82.4,20.79,15.0,74.05,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(103,'2026-10-13T20:55:52.829578',24.12,82.9,22.21,15.0,73.75,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(104,'2026-10-13T20:56:04.902804',24.4,82.0,20.26,15.0,74.12,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(105,'2026-10-13T20:56:15.992513',23.71,81.3,21.5,15.0,72.94,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(106,'2026-10-13T20:56:29.060940',23.88,81.8,22.06,15.0,73.25,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(107,'2026-10-13T20:56:41.145801',23.94,81.2,21.7,15.0,73.3,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(108,'2026-10-13T20:56:54.245250',23.62,81.4,21.77,15.0,72.8,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(109,'2026-10-13T20:57:06.335685',24.12,82.1,22.66,15.0,73.67,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(110,'2026-10-13T20:57:18.427495',23.93,81.4,22.53,15.0,73.3,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(111,'2026-10-13T20:57:30.510970',23.87,82.6,21.96,15.0,73.32,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(112,'2026-10-13T20:57:41.656017',24.29,81.7,21.4,15.0,73.91,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(113,'2026-10-13T20:57:54.755255',24.33,81.8,22.5,15.0,73.99,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(114,'2026-10-13T20:58:05.844028',24.08,81.6,22.05,15.0,73.56,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(115,'2026-10-13T20:58:16.990019',23.96,81.9,22.63,15.0,73.4,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(116,'2026-10-13T20:58:29.048283',23.7,82.4,21.12,15.0,73.02,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(117,'2026-10-13T20:58:40.129105',23.73,83.0,21.18,15.0,73.12,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(118,'2026-10-13T20:58:50.197370',24.29,81.4,20.34,15.0,73.89,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(119,'2026-10-13T20:59:01.277211',23.96,82.8,21.58,15.0,73.49,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(120,'2026-10-13T20:59:11.320466',24.03,81.5,20.38,15.0,73.48,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(121,'2026-10-13T20:59:22.391640',24.05,83.0,21.76,15.0,73.65,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(122,'2026-10-13T20:59:34.478517',24.22,82.6,21.89,15.0,73.88,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(123,'2026-10-13T20:59:44.540735',24.36,81.6,20.57,15.0,74.02,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(124,'2026-10-13T20:59:54.619519',24.36,82.2,21.14,15.0,74.08,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(125,'2026-10-13T21:00:10.753521',23.7,82.9,21.15,15.0,73.07,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(126,'2026-10-13T21:00:21.847163',24.04,82.9,20.6,15.0,73.63,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(127,'2026-10-13T21:00:32.920942',23.8,82.8,20.35,15.0,73.23,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(128,'2026-10-13T21:00:44.014887',23.66,81.4,22.57,15.0,72.87,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(129,'2026-10-13T21:00:54.077042',23.81,82.0,21.55,15.0,73.16,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(130,'2026-10-13T21:01:00.130531',23.78,81.3,22.19,15.0,73.05,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(131,'2026-10-13T21:01:04.154334',23.97,82.9,20.65,15.0,73.52,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(132,'2026-10-13T21:01:09.184994',24.17,81.0,22.51,15.0,73.66,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(133,'2026-10-13T21:01:15.220140',24.13,81.6,22.12,15.0,73.64,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(134,'2026-10-13T21:01:20.317341',24.1,82.4,21.93,15.0,73.67,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(135,'2026-10-13T21:01:25.351205',23.69,81.5,20.69,15.0,72.93,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(136,'2026-10-13T21:01:30.392545',24.38,81.9,21.78,15.0,74.09,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(137,'2026-10-13T21:01:35.427470',24.18,82.5,20.74,15.0,73.81,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(138,'2026-10-13T21:01:40.456289',23.72,82.5,21.8,15.0,73.06,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(139,'2026-10-13T21:01:45.492110',24.17,81.4,21.4,15.0,73.69,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(140,'2026-10-13T21:01:50.523075',23.97,81.6,21.27,15.0,73.39,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(141,'2026-10-13T21:01:55.553798',24.29,82.7,20.7,15.0,74.02,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(142,'2026-10-13T21:02:00.582811',24.28,82.2,22.63,15.0,73.95,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(143,'2026-10-13T21:02:05.596845',23.73,81.0,21.11,15.0,72.95,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(144,'2026-10-13T21:02:10.616154',24.33,81.3,22.17,15.0,73.95,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(145,'2026-10-13T21:02:15.649949',23.74,81.8,21.04,15.0,73.04,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(146,'2026-10-13T21:02:20.689848',24.22,82.8,21.53,15.0,73.91,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(147,'2026-10-13T21:02:25.716981',23.7,81.1,22.39,15.0,72.9,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(148,'2026-10-13T21:02:30.732347',24.17,81.5,20.87,15.0,73.7,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(149,'2026-10-13T21:02:35.762463',24.21,82.3,20.98,15.0,73.84,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(150,'2026-10-13T21:02:41.798620',23.9,82.1,20.88,15.0,73.32,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(151,'2026-10-13T21:02:46.823043',23.73,81.9,21.27,15.0,73.02,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(152,'2026-10-13T21:02:51.851089',23.62,81.9,20.72,15.0,72.85,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(153,'2026-10-13T21:02:55.884320',23.9,82.5,21.64,15.0,73.36,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(154,'2026-10-13T21:03:07.962970',24.12,81.0,21.65,15.0,73.57,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(155,'2026-10-13T21:03:15.008789',24.22,82.3,21.39,15.0,73.85,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(156,'2026-10-13T21:03:22.055424',24.19,82.2,21.31,15.0,73.79,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(157,'2026-10-13T21:03:28.089949',23.92,82.3,21.25,15.0,73.36,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(158,'2026-10-13T21:03:35.112828',24.32,81.9,21.4,15.0,73.98,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(159,'2026-10-13T21:03:41.176684',24.32,81.5,22.52,15.0,73.94,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(160,'2026-10-13T21:03:51.255828',24.25,82.2,20.65,15.0,73.89,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(161,'2026-10-13T21:04:01.325300',24.08,81.3,21.65,15.0,73.54,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(162,'2026-10-13T21:04:11.405396',24.28,82.4,22.68,15.0,73.96,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(163,'2026-10-13T21:04:27.591380',24.02,81.7,20.49,15.0,73.48,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(164,'2026-10-13T21:04:48.749669',23.66,81.4,22.12,15.0,72.87,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(165,'2026-10-13T21:05:07.868617',24.15,81.6,22.31,15.0,73.67,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(166,'2026-10-13T21:05:57.556814',24.03,81.4,22.37,15.0,73.47,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(167,'2026-10-13T21:07:57.984812',23.92,81.3,22.18,15.0,73.27,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(168,'2026-10-13T21:08:38.348066',24.02,82.4,22.64,15.0,73.55,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(169,'2026-10-13T21:09:00.520546',23.91,82.6,21.91,15.0,73.39,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(170,'2026-10-13T21:09:19.676767',23.66,81.2,21.25,15.0,72.86,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(171,'2026-10-13T21:09:38.828153',23.88,82.1,21.08,15.0,73.29,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(172,'2026-10-13T21:09:58.950463',24.28,82.4,20.47,15.0,73.97,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(173,'2026-10-13T21:10:29.242408',23.93,81.9,21.49,15.0,73.35,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(174,'2026-10-13T21:10:50.460941',24.11,81.6,20.55,15.0,73.62,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(175,'2026-10-13T21:11:09.614923',23.71,82.3,22.2,15.0,73.03,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(176,'2026-10-13T21:11:27.734380',23.89,82.4,22.05,15.0,73.33,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(177,'2026-10-13T21:11:48.906724',23.6,82.3,22.26,15.0,72.85,'Mild Alert');
INSERT INTO "environmental_logs_raw" VALUES(178,'2026-10-13T21:12:17.117146',24.05,81.5,21.17,15.0,73.49,'Mild Alert');
CREATE TABLE hourly_flock_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                hour_slot TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                total_frames INTEGER NOT NULL,
                avg_fps REAL NOT NULL,
                unique_birds INTEGER NOT NULL,
                avg_birds_present REAL NOT NULL,
                rooster_detections INTEGER NOT NULL,
                identified_hens_count INTEGER NOT NULL,
                unidentified_chickens_count INTEGER NOT NULL,
                feeding_time_pct REAL NOT NULL,
                drinking_time_pct REAL NOT NULL,
                active_time_pct REAL NOT NULL,
                resting_time_pct REAL NOT NULL,
                agitated_time_pct REAL NOT NULL,
                flock_mobility_score REAL NOT NULL,
                temp_mean REAL NOT NULL,
                temp_min REAL NOT NULL,
                temp_max REAL NOT NULL,
                humidity_mean REAL NOT NULL,
                humidity_min REAL NOT NULL,
                humidity_max REAL NOT NULL,
                ammonia_ppm_mean REAL NOT NULL,
                ammonia_ppm_max REAL NOT NULL,
                lux_mean REAL NOT NULL,
                thi_mean REAL NOT NULL,
                heat_stress_alert TEXT NOT NULL,
                notes TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
INSERT INTO "hourly_flock_telemetry" VALUES(1,'2026-10-13','20:00 - 21:00','2026-10-13T20:09:53.492247','2026-10-13T20:10:01.394620',60,13.5,21,6.83,59,2,10,54.39,0.0,39.02,5.12,1.46,0.41,23.84,23.6,24.35,82.2,81.8,82.6,20.98,21.93,15.0,73.23,'Normal','Aggregated 60 frames over window.','2026-10-13 12:10:01');
INSERT INTO "hourly_flock_telemetry" VALUES(2,'2026-10-13','20:00 - 21:00','2026-10-13T20:12:24.899052','2026-10-13T20:12:32.507258',45,6.8,12,6.89,45,2,8,56.77,0.0,39.35,3.87,0.0,0.39,24.03,23.74,24.25,82.0,81.2,83.0,21.08,21.95,15.0,73.52,'Normal','Aggregated 45 frames over window.','2026-10-13 12:12:32');
INSERT INTO "hourly_flock_telemetry" VALUES(3,'2026-10-13','20:00 - 21:00','2026-10-13T20:19:37.212106','2026-10-13T20:19:44.851082',45,6.9,12,6.89,45,2,8,56.77,0.0,39.68,3.55,0.0,0.4,23.93,23.67,24.29,82.2,81.0,82.9,21.12,22.09,15.0,73.38,'Normal','Aggregated 45 frames over window.','2026-10-13 12:19:44');
INSERT INTO "hourly_flock_telemetry" VALUES(4,'2026-10-13','20:00 - 21:00','2026-10-13T20:36:35.009602','2026-10-13T20:36:47.890767',45,6.4,12,6.89,45,2,8,56.77,0.0,37.74,5.48,0.0,0.38,23.96,23.81,24.4,81.9,81.1,82.8,21.03,22.13,15.0,73.41,'Normal','Aggregated 45 frames over window.','2026-10-13 12:36:47');
INSERT INTO "hourly_flock_telemetry" VALUES(5,'2026-10-13','20:00 - 21:00','2026-10-13T20:45:12.592981','2026-10-13T21:00:00.070474',7408,16.4,309,5.9,8029,5,219,32.4,22.55,27.28,4.37,13.4,0.47,23.99,23.6,24.4,82.0,81.0,83.0,21.35,22.66,15.0,73.46,'Normal','Aggregated 7408 frames over window.','2026-10-13 13:00:00');
CREATE INDEX idx_flock_date_hour ON hourly_flock_telemetry (date, hour_slot);
CREATE INDEX idx_bird_date_hour ON bird_hourly_behavior (date, hour_slot);
CREATE INDEX idx_env_ts ON environmental_logs_raw (timestamp);
DELETE FROM "sqlite_sequence";
INSERT INTO "sqlite_sequence" VALUES('environmental_logs_raw',178);
INSERT INTO "sqlite_sequence" VALUES('hourly_flock_telemetry',5);
INSERT INTO "sqlite_sequence" VALUES('bird_hourly_behavior',211);
COMMIT;
