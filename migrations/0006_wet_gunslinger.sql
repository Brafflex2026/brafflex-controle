CREATE TABLE `demanda` (
	`id` text PRIMARY KEY NOT NULL,
	`contrato_id` text,
	`cliente_texto` text,
	`titulo` text,
	`modo` text,
	`custo_alto` integer,
	`caminho` text,
	`status` text NOT NULL,
	`versao` integer NOT NULL,
	`devolucoes` integer NOT NULL,
	`estado` text NOT NULL,
	`n_eventos` integer NOT NULL,
	`trilha_head` text NOT NULL,
	`ultimo_evento_em` text,
	`verificacao` text,
	`recebido_em` text NOT NULL,
	`atualizado_em` text NOT NULL,
	FOREIGN KEY (`contrato_id`) REFERENCES `contrato`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trilha_evento` (
	`demanda_id` text NOT NULL,
	`n` integer NOT NULL,
	`ts` text NOT NULL,
	`cmd` text NOT NULL,
	`ator` text NOT NULL,
	`dados` text NOT NULL,
	`prev` text NOT NULL,
	`hash` text NOT NULL,
	`assinatura` text,
	`linha` text NOT NULL,
	`recebido_em` text NOT NULL,
	PRIMARY KEY(`demanda_id`, `n`),
	FOREIGN KEY (`demanda_id`) REFERENCES `demanda`(`id`) ON UPDATE no action ON DELETE no action
);
