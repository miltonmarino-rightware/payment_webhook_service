CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`paymentId` int NOT NULL,
	`externalSystemWebhook` varchar(512) NOT NULL,
	`status` enum('PENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
	`responseStatus` int,
	`responseBody` text,
	`attemptCount` int NOT NULL DEFAULT 0,
	`nextRetryAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`transactionId` varchar(64) NOT NULL,
	`operatorReference` varchar(128),
	`externalSystemId` varchar(128) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'MZN',
	`status` enum('CREATED','PENDING','SUCCESS','FAILED','EXPIRED','COMPLETED') NOT NULL DEFAULT 'CREATED',
	`previousStatus` varchar(32),
	`operatorResponse` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	`expiresAt` timestamp,
	`ipAddress` varchar(45),
	`userAgent` text,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_transactionId_unique` UNIQUE(`transactionId`)
);
--> statement-breakpoint
CREATE TABLE `transaction_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`paymentId` int NOT NULL,
	`eventType` varchar(32) NOT NULL,
	`details` json,
	`ipAddress` varchar(45),
	`userAgent` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transaction_logs_id` PRIMARY KEY(`id`)
);
