CREATE TABLE `contrato` (
	`id` text PRIMARY KEY NOT NULL,
	`chave` text NOT NULL,
	`cliente_id` text NOT NULL,
	`marca` text NOT NULL,
	`tipo` text NOT NULL,
	`escopo` text,
	`verba_centavos` integer,
	`periodo_inicio` text,
	`periodo_fim` text,
	`status` text NOT NULL,
	`encerrado_em` text,
	`contato_aprovador` text,
	`leitura_autorizada_em` text,
	`leitura_autorizada_por` text,
	`leitura_revogada_em` text,
	`criado_em` text NOT NULL,
	`atualizado_em` text NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `cliente`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contrato_chave_unique` ON `contrato` (`chave`);