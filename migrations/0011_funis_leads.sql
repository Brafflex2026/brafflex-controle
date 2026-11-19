-- Funis, estágios e leads. Funis e estágios saem prontos (desenho do agente CRM, agentes/crm.md seções 9 a 11).
CREATE TABLE `funil` (
	`id` text PRIMARY KEY NOT NULL,
	`nome` text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE `estagio` (
	`id` text PRIMARY KEY NOT NULL,
	`funil_id` text NOT NULL REFERENCES `funil`(`id`),
	`ordem` integer NOT NULL,
	`nome` text NOT NULL,
	`final` text CHECK (`final` IS NULL OR `final` IN ('Ganho', 'Perdido', 'Não contatar', 'Nutrir'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estagio_funil_ordem` ON `estagio` (`funil_id`, `ordem`);
--> statement-breakpoint
CREATE UNIQUE INDEX `estagio_funil_nome` ON `estagio` (`funil_id`, `nome`);
--> statement-breakpoint
CREATE TABLE `lead` (
	`id` text PRIMARY KEY NOT NULL,
	`chave` text NOT NULL,
	`funil_id` text NOT NULL REFERENCES `funil`(`id`),
	`estagio_id` text NOT NULL REFERENCES `estagio`(`id`),
	`estagio_desde` text NOT NULL,
	`empresa` text NOT NULL,
	`contato` text,
	`telefone` text,
	`place_id` text,
	`nota` integer CHECK (`nota` IS NULL OR (`nota` >= 0 AND `nota` <= 100)),
	`faixa` text CHECK (`faixa` IS NULL OR `faixa` IN ('Quente', 'Morno', 'Frio')),
	`origem` text NOT NULL,
	`base_legal` text NOT NULL,
	`consentimento_em` text,
	`consentimento_como` text,
	`opt_out_em` text,
	`ultimo_contato_em` text,
	`ultimo_contato_canal` text,
	`proximo_passo` text,
	`proximo_passo_em` text,
	`responsavel` text,
	`motivo_perda` text,
	`observacoes` text,
	`cliente_id` text,
	`criado_em` text NOT NULL,
	`atualizado_em` text NOT NULL,
	`criado_por` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_chave_unica` ON `lead` (`chave`);
--> statement-breakpoint
-- Chaves contra duplicata: vazio não conta (vários leads podem ficar sem telefone ou sem Place ID).
CREATE UNIQUE INDEX `lead_telefone_unico` ON `lead` (`telefone`) WHERE `telefone` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_place_id_unico` ON `lead` (`place_id`) WHERE `place_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `lead_funil_estagio` ON `lead` (`funil_id`, `estagio_id`);
--> statement-breakpoint
CREATE INDEX `lead_proximo_passo_em` ON `lead` (`proximo_passo_em`);
--> statement-breakpoint
-- Histórico do lead: só acréscimo. A nota nunca guarda telefone nem e-mail (a barreira recusa), para o opt-out poder apagar o contato só da linha do lead.
CREATE TABLE `lead_evento` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` text NOT NULL REFERENCES `lead`(`id`),
	`ts` text NOT NULL,
	`tipo` text NOT NULL CHECK (`tipo` IN ('criacao', 'estagio', 'contato')),
	`de` text,
	`para` text,
	`canal` text,
	`nota` text,
	`usuario` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lead_evento_lead` ON `lead_evento` (`lead_id`, `id`);
--> statement-breakpoint
CREATE TRIGGER `lead_evento_sem_update` BEFORE UPDATE ON `lead_evento`
BEGIN
	SELECT RAISE(ABORT, 'histórico do lead é só de acréscimo: não se altera');
END;
--> statement-breakpoint
CREATE TRIGGER `lead_evento_sem_delete` BEFORE DELETE ON `lead_evento`
BEGIN
	SELECT RAISE(ABORT, 'histórico do lead é só de acréscimo: não se apaga');
END;
--> statement-breakpoint
INSERT INTO `funil` (`id`, `nome`) VALUES ('ravclin', 'Ravclin'), ('etiqueteria', 'Etiqueteria'), ('brafflex', 'Brafflex');
--> statement-breakpoint
INSERT INTO `estagio` (`id`, `funil_id`, `ordem`, `nome`, `final`) VALUES
	('ravclin-1', 'ravclin', 1, 'Novo', NULL),
	('ravclin-2', 'ravclin', 2, 'Em contato', NULL),
	('ravclin-3', 'ravclin', 3, 'Conversa', NULL),
	('ravclin-4', 'ravclin', 4, 'Reunião ou demo', NULL),
	('ravclin-5', 'ravclin', 5, 'Proposta', NULL),
	('ravclin-6', 'ravclin', 6, 'Ganho', 'Ganho'),
	('ravclin-7', 'ravclin', 7, 'Nutrir', 'Nutrir'),
	('ravclin-8', 'ravclin', 8, 'Perdido', 'Perdido'),
	('ravclin-9', 'ravclin', 9, 'Não contatar', 'Não contatar'),
	('etiqueteria-1', 'etiqueteria', 1, 'Captado', NULL),
	('etiqueteria-2', 'etiqueteria', 2, 'Abordado', NULL),
	('etiqueteria-3', 'etiqueteria', 3, 'Em conversa', NULL),
	('etiqueteria-4', 'etiqueteria', 4, 'Demo agendada', NULL),
	('etiqueteria-5', 'etiqueteria', 5, 'Demo feita', NULL),
	('etiqueteria-6', 'etiqueteria', 6, 'Inscrito', NULL),
	('etiqueteria-7', 'etiqueteria', 7, 'Beta', NULL),
	('etiqueteria-8', 'etiqueteria', 8, 'Gráfica ativa', 'Ganho'),
	('etiqueteria-9', 'etiqueteria', 9, 'Lista de espera', 'Nutrir'),
	('etiqueteria-10', 'etiqueteria', 10, 'Fora do perfil', 'Perdido'),
	('etiqueteria-11', 'etiqueteria', 11, 'Perdido', 'Perdido'),
	('etiqueteria-12', 'etiqueteria', 12, 'Não contatar', 'Não contatar'),
	('brafflex-1', 'brafflex', 1, 'Contato', NULL),
	('brafflex-2', 'brafflex', 2, 'Qualificado', NULL),
	('brafflex-3', 'brafflex', 3, 'Em conversa', NULL),
	('brafflex-4', 'brafflex', 4, 'Diagnóstico agendado', NULL),
	('brafflex-5', 'brafflex', 5, 'Diagnóstico feito', NULL),
	('brafflex-6', 'brafflex', 6, 'Proposta apresentada', NULL),
	('brafflex-7', 'brafflex', 7, 'Contrato', NULL),
	('brafflex-8', 'brafflex', 8, 'Cliente', 'Ganho'),
	('brafflex-9', 'brafflex', 9, 'Nutrir', 'Nutrir'),
	('brafflex-10', 'brafflex', 10, 'Perdido', 'Perdido'),
	('brafflex-11', 'brafflex', 11, 'Não contatar', 'Não contatar');
