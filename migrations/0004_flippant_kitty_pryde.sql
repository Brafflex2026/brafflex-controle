CREATE TABLE `integracao` (
	`id` text PRIMARY KEY NOT NULL,
	`chave` text NOT NULL,
	`contrato_id` text NOT NULL,
	`tipo` text NOT NULL,
	`id_externo` text,
	`dono` text,
	`estado` text NOT NULL,
	`o_que_falta` text,
	`verificada_em` text,
	`revogada_em` text,
	`criado_em` text NOT NULL,
	`atualizado_em` text NOT NULL,
	FOREIGN KEY (`contrato_id`) REFERENCES `contrato`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integracao_chave_unique` ON `integracao` (`chave`);--> statement-breakpoint
CREATE UNIQUE INDEX `integracao_contrato_tipo_id` ON `integracao` (`contrato_id`,`tipo`,`id_externo`);