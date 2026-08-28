import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    ParseIntPipe,
    UseGuards,
    UseInterceptors,
    UploadedFiles,
    Req,
    BadRequestException,
} from '@nestjs/common';
import { ArticleService } from './article.service';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
    IArticleCreate,
    IArticleUpdate,
    IArticleQuery,
    IArticleWithUser,
    IArticleFetchResult,
    IArticlePublicFetchResult,
    IArticlePublicWithUser,
    IArticlePreview,
} from '@scspace-depot/types/article';
import { publicStorage } from '@scspace-server/tools/file/file.storage';
import { ISuccessResponse } from '@scspace-depot/types/common';
import { Request } from 'express';
import { IUser } from '@scspace-depot/types/user';
import { UserUtils } from '@scspace-depot/utils/user.utils';
import { ManagerGuard } from '../auth/jwt/jwt.guard';
import { ArticleStateEnum } from '@scspace-depot/enums/article.enum';
import { Public } from '../../common/decorators/public.decorator';

@Controller('article')
export class ArticleController {
    constructor(
        private readonly articleService: ArticleService,
    ) { }

    @Public()
    @Get('preview')
    async getArticlePreviews(): Promise<IArticlePreview> {
        const previews = await this.articleService.getArticlePreviews();
        return {
            notice: this.toPublicArticle(previews.notice),
            business: this.toPublicArticle(previews.business),
            promotion: this.toPublicArticle(previews.promotion),
        };
    }

    @Post()
    @UseGuards(ManagerGuard)
    @UseInterceptors(
        FileFieldsInterceptor([
            { name: 'images', maxCount: 12 },
            { name: 'files', maxCount: 8 },
        ], {
            storage: publicStorage,
        })
    )
    async createArticle(
        @Req() req: Request,
        @Body() createData: Omit<IArticleCreate, 'userId' | 'images' | 'files'>,
        @UploadedFiles() files: { images?: Express.Multer.File[], files?: Express.Multer.File[] }
    ) {
        const user = req.user as IUser;
        const userId = user.id;
        const state = createData.state === undefined
            ? ArticleStateEnum.HIDE
            : this.normalizeArticleState(createData.state);

        // Handle uploaded files
        const imageData = files?.images ? JSON.stringify(files.images.map(f => f.filename)) : undefined;
        const fileData = files?.files ? JSON.stringify(files.files.map(f => f.filename)) : undefined;

        const articleData = {
            ...createData,
            state,
            images: imageData,
            files: fileData,
        };

        return await this.articleService.createArticle(userId, articleData);
    }

    @Public()
    @Get()
    async getArticles(
        @Query() query: IArticleQuery,
    ): Promise<IArticlePublicFetchResult> {
        const result = await this.articleService.getArticles({ ...query, state: ArticleStateEnum.FOR_ALL });
        return this.toPublicFetchResult(result);
    }

    @Public()
    @Get('search')
    async searchArticles(
        @Query('q') searchTerm: string,
        @Query() query: Omit<IArticleQuery, 'search'>,
    ): Promise<IArticlePublicFetchResult> {
        const result = await this.articleService.searchArticles(searchTerm, { ...query, state: ArticleStateEnum.FOR_ALL });
        return this.toPublicFetchResult(result);
    }

    @Public()
    @Get('type/:type')
    async getArticlesByType(
        @Param('type', ParseIntPipe) type: number,
        @Query() query: Omit<IArticleQuery, 'type'>,
    ): Promise<IArticlePublicFetchResult> {
        const result = await this.articleService.getArticlesByType(type, { ...query, state: ArticleStateEnum.FOR_ALL });
        return this.toPublicFetchResult(result);
    }

    @Get('manage')
    @UseGuards(ManagerGuard)
    async getManagedArticles(
        @Query() query: IArticleQuery,
    ): Promise<IArticleFetchResult> {
        return await this.articleService.getArticles(query);
    }

    @Get('manage/:id')
    @UseGuards(ManagerGuard)
    async getManagedArticleById(
        @Param('id', ParseIntPipe) id: number,
    ) {
        return await this.articleService.getArticleById(id);
    }

    @Get('my')
    @UseGuards(ManagerGuard)
    async getMyArticles(@Req() req: any, @Query() query: Omit<IArticleQuery, 'userId'>) {
        const userId = req.user.id;
        return await this.articleService.getUserArticles(userId, query);
    }

    @Public()
    @Get(':id')
    async getArticleById(
        @Param('id', ParseIntPipe) id: number,
    ): Promise<IArticlePublicWithUser> {
        const data = await this.articleService.getArticleById(id);

        if (data.state === ArticleStateEnum.FOR_ALL) return this.toPublicArticle(data);

        throw new BadRequestException('You do not have permission to view this article.');
    }

    @Put(':id')
    @UseGuards(ManagerGuard)
    async updateArticle(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: Request,
        @Body() updateData: IArticleUpdate,
    ) {
        const user = req.user as IUser;
        const userId = user.id;
        const isManager = UserUtils.isManager(user.type);
        const safeUpdateData = updateData.state === undefined
            ? updateData
            : { ...updateData, state: this.normalizeArticleState(updateData.state) };

        return await this.articleService.updateArticle(id, userId, safeUpdateData, isManager);
    }

    @Put(':id/image')
    @UseGuards(ManagerGuard)
    @UseInterceptors(
        FileFieldsInterceptor([
            { name: 'images', maxCount: 20 },
        ], {
            storage: publicStorage,
        })
    )
    async updateArticleImage(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: Request,
        @UploadedFiles() files: { images?: Express.Multer.File[] }
    ) {
        const user = req.user as IUser;
        const userId = user.id;
        const isManager = UserUtils.isManager(user.type);

        const imageData = files?.images ? JSON.stringify(files.images.map(f => f.filename)) : undefined;

        return await this.articleService.updateArticle(id, userId, { images: imageData }, isManager);
    }

    @Put(':id/file')
    @UseGuards(ManagerGuard)
    @UseInterceptors(
        FileFieldsInterceptor([
            { name: 'images', maxCount: 20 },
            { name: 'files', maxCount: 20 },
        ], {
            storage: publicStorage,
        })
    )
    async updateArticleFile(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: Request,
        @UploadedFiles() files: { images?: Express.Multer.File[], files?: Express.Multer.File[] }
    ) {
        const user = req.user as IUser;
        const userId = user.id;
        const isManager = UserUtils.isManager(user.type);

        const imageData = files?.images ? JSON.stringify(files.images.map(f => f.filename)) : undefined;
        const fileData = files?.files ? JSON.stringify(files.files.map(f => f.filename)) : undefined;

        return await this.articleService.updateArticleFile(id, userId, {
            images: imageData,
            files: fileData
        }, isManager);
    }

    @Delete(':id')
    @UseGuards(ManagerGuard)
    async deleteArticle(@Param('id', ParseIntPipe) id: number, @Req() req: any): Promise<ISuccessResponse> {
        const userId = req.user.id;
        const isManager = UserUtils.isManager(req.user.type);

        await this.articleService.deleteArticle(id, userId, isManager);

        return { success: true };
    }

    @Put(':id/state')
    @UseGuards(ManagerGuard)
    async showArticle(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: any,
        @Body() body: { state: ArticleStateEnum }
    ) {
        const userId = req.user.id;
        const isManager = UserUtils.isManager(req.user.type);
        const state = this.normalizeArticleState(body.state);

        return await this.articleService.setArticleState(id, userId, state, isManager);
    }

    private toPublicArticle(article: IArticleWithUser): IArticlePublicWithUser {
        return {
            id: article.id,
            title: article.title,
            content: article.content,
            timePost: article.timePost,
            timeUpdate: article.timeUpdate,
            state: article.state,
            type: article.type,
            images: article.images,
            files: article.files,
            user: { nameKr: article.user.nameKr },
        };
    }

    private toPublicFetchResult(result: IArticleFetchResult): IArticlePublicFetchResult {
        return {
            ...result,
            articles: result.articles.map(article => this.toPublicArticle(article)),
        };
    }

    private normalizeArticleState(state: unknown): ArticleStateEnum {
        if (state === ArticleStateEnum.HIDE || state === String(ArticleStateEnum.HIDE)) {
            return ArticleStateEnum.HIDE;
        }
        if (state === ArticleStateEnum.FOR_ALL || state === String(ArticleStateEnum.FOR_ALL)) {
            return ArticleStateEnum.FOR_ALL;
        }
        throw new BadRequestException('Article state must be HIDE or FOR_ALL.');
    }
}
