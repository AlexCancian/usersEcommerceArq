import { Router, Request, Response, NextFunction } from "express";
import {
  AuthenticatedRequest,
  authenticateJWT,
  requireRoles,
} from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createUsuarioSchema,
  updateUsuarioSchema,
  createEnderecoSchema,
  enderecoIdParamSchema,
} from "../utils/schemas.js";
import {
  createUsuarioService,
  getMeService,
  updateMeService,
  getAllUsuariosService,
} from "../services/usuario.service.js";
import {
  listEnderecosService,
  createEnderecoService,
  deleteEnderecoService,
} from "../services/endereco.service.js";

const router = Router();

// POST /usuarios - Cadastro público de novo usuário
router.post(
  "/",
  validate(createUsuarioSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const usuario = await createUsuarioService(req.body);
      return res.status(201).json(usuario);
    } catch (error) {
      next(error);
    }
  }
);

// GET /usuarios - Listar todos os usuários (Acesso restrito para admin)
router.get(
  "/",
  authenticateJWT,
  requireRoles(["admin"]),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const usuarios = await getAllUsuariosService();
      return res.status(200).json(usuarios);
    } catch (error) {
      next(error);
    }
  }
);

// GET /usuarios/me - Obter dados do usuário autenticado
router.get(
  "/me",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const usuario = await getMeService(req.user!.id);
      return res.status(200).json(usuario);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /usuarios/me - Atualizar dados do usuário autenticado
router.put(
  "/me",
  authenticateJWT,
  validate(updateUsuarioSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const usuario = await updateMeService(req.user!.id, req.body);
      return res.status(200).json(usuario);
    } catch (error) {
      next(error);
    }
  }
);

// GET /usuarios/me/enderecos - Listar endereços do usuário autenticado
router.get(
  "/me/enderecos",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const enderecos = await listEnderecosService(req.user!.id);
      return res.status(200).json(enderecos);
    } catch (error) {
      next(error);
    }
  }
);

// POST /usuarios/me/enderecos - Cadastrar novo endereço para usuário autenticado
router.post(
  "/me/enderecos",
  authenticateJWT,
  validate(createEnderecoSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const endereco = await createEnderecoService(req.user!.id, req.body);
      return res.status(201).json(endereco);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /usuarios/me/enderecos/:id - Excluir endereço do usuário autenticado
router.delete(
  "/me/enderecos/:id",
  authenticateJWT,
  validate(enderecoIdParamSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await deleteEnderecoService(req.user!.id, req.params.id);
      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
