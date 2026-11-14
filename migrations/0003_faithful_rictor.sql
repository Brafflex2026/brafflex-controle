CREATE TABLE `briefing` (
	`id` text PRIMARY KEY NOT NULL,
	`chave` text NOT NULL,
	`contrato_id` text NOT NULL,
	`versao` integer NOT NULL,
	`conteudo` text NOT NULL,
	`criado_por` text NOT NULL,
	`criado_em` text NOT NULL,
	`confirmado_em` text,
	`confirmado_por` text,
	FOREIGN KEY (`contrato_id`) REFERENCES `contrato`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `briefing_chave_unique` ON `briefing` (`chave`);--> statement-breakpoint
CREATE UNIQUE INDEX `briefing_contrato_versao` ON `briefing` (`contrato_id`,`versao`);