import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Query,
    Body,
    ParseIntPipe,
    UseGuards,
    Req,
    UseInterceptors,
    UploadedFile,
    Logger,
    Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RentalService } from './rental.service';
import {
    IRentalAll,
    IGoods,
    IGoodsCreate,
    IGoodsUpdate,
    IGoodsAvailabilityCheck,
    IUserRentalStatus,
    IRentalCreateAdmin,
    IRentalUpdateAdmin,
} from '@scspace-depot/types/rental';
import { IDataResponse, ISuccessResponse } from '@scspace-depot/types/common';
import { ManagerGuard, MemberGuard, UserGuard } from '../auth/jwt/jwt.guard';
import { IUser } from '@scspace-depot/types/user';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { publicStorage } from '@scspace-server/tools/file/file.storage';

@Controller('rental')
export class RentalController {
    constructor(
        private readonly rentalService: RentalService
    ) { }

    // Rental 관련 엔드포인트들

    @Post('admin')
    @UseGuards(ManagerGuard)
    async createRentalAdmin(
        @Body() rentalData: IRentalCreateAdmin,
        @Req() req: Request
    ): Promise<{ success: boolean; data: { id: number } }> {
        const admin = req.user as IUser;
        return await this.rentalService.createRentalAdmin({
            ...rentalData,
            approverId: admin.id,
        });
    }

    //반납 요청 : 특정 렌탈
    // @Post('returnreq')
    // @UseGuards(ManagerGuard)
    // async returnRequest(
    //     @Body('rentalId') rentalId: number,
    // ): Promise<{
    //     success: boolean,
    //     id: number,
    // }> {
    //     return await this.rentalService.rentalReturnRequest(rentalId);
    // }

    //반납 요청 : 모든 overdue 렌탈
    // @Post('returnreq/all')
    // @UseGuards(AdminGuard)
    // async returnRequestAll(): Promise<{
    //     success: boolean,
    //     id: number,
    // }[]> {
    //     return await this.rentalService.rentalReturnRequestAll()
    // }

    // 모든 대여 목록 조회 (관리자용)
    @Get()
    @UseGuards(ManagerGuard)
    async getRentalList(
        @Query('limit', ParseIntPipe) limit: number = 50,
        @Query('offset', ParseIntPipe) offset: number = 0
    ): Promise<IDataResponse<IRentalAll[]>> {
        return await this.rentalService.getRentalList(limit, offset);
    }

    // 특정 대여 조회
    @Get(':id/certificate')
    @UseGuards(AuthGuard('jwt'))
    async downloadRentalCertificate(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: Request,
        @Res() res: Response,
    ): Promise<void> {
        const filePath = await this.rentalService.getRentalCertificate(id, req.user as IUser);

        return await new Promise<void>((resolveDownload, rejectDownload) => {
            res.download(filePath, `Rental_Confirmation_No${id}.pdf`, (error) => {
                if (error) {
                    rejectDownload(error);
                    return;
                }
                resolveDownload();
            });
        });
    }

    // 특정 대여 조회
    @Get(':id')
    // @UseGuards(UserGuard)
    @UseGuards(AuthGuard('jwt'))
    async getRentalById(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: Request,
    ): Promise<IRentalAll> {
        return await this.rentalService.getRentalById(id, req.user as IUser);
    }

    // 사용자별 대여 목록 조회
    @Get('user/:userId')
    @UseGuards(UserGuard)
    async getUserRentals(
        @Param('userId', ParseIntPipe) userId: number,
        @Query('isActive') isActive?: string,
        @Query('limit', ParseIntPipe) limit: number = 50,
        @Query('offset', ParseIntPipe) offset: number = 0,
    ): Promise<IDataResponse<IRentalAll[]>> {
        const params: IUserRentalStatus = {
            userId,
            isActive: isActive ? isActive === 'true' : undefined,
            limit,
            offset,
        };
        return await this.rentalService.getUserRentals(params);
    }

    // 내 대여 목록 조회
    @Get('my/list')
    // @UseGuards(MemberGuard)
    @UseGuards(AuthGuard('jwt'))
    async getMyRentals(
        @Req() req: Request,
        @Query('isActive') isActive?: string,
        @Query('limit', ParseIntPipe) limit: number = 50,
        @Query('offset', ParseIntPipe) offset: number = 0,
    ): Promise<IDataResponse<IRentalAll[]>> {
        const user = req.user as IUser;
        const params: IUserRentalStatus = {
            userId: user.id,
            isActive: isActive ? isActive === 'true' : undefined,
            limit,
            offset,
        };
        return await this.rentalService.getUserRentals(params);
    }

    // 연체된 대여 목록 조회
    // @Get('overdue/list')
    // @UseGuards(ManagerGuard)
    // async getOverdueRentals(): Promise<IRentalAll[]> {
    //     return await this.rentalService.getOverdueRentals();
    // }

    @Put(':id')
    @UseGuards(ManagerGuard)
    async updateRental(
        @Param('id', ParseIntPipe) id: number,
        @Body() updates: IRentalUpdateAdmin,
        @Req() req: Request,
    ): Promise<ISuccessResponse> {
        return await this.rentalService.updateRentalAdmin(id, updates, req.user as IUser);
    }

    // 반납 확인 (관리자용)
    @Put(':id/confirm')
    @UseGuards(ManagerGuard)
    async confirmReturn(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: Request,
    ): Promise<ISuccessResponse> {
        const manager = req.user as IUser;
        return await this.rentalService.confirmReturn(id, manager);
    }

    @Put(':id/contact')
    @UseGuards(ManagerGuard)
    async markOverdueContacted(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: Request,
    ): Promise<ISuccessResponse> {
        return await this.rentalService.markOverdueContacted(id, req.user as IUser);
    }

    @Delete(':id')
    @UseGuards(ManagerGuard)
    async cancelRental(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: Request,
    ): Promise<ISuccessResponse> {
        return await this.rentalService.cancelRental(id, req.user as IUser);
    }

    // Goods 관련 엔드포인트들

    // 물품 생성
    @Post('goods')
    @UseInterceptors(FileInterceptor('file', {
        storage: publicStorage,
        limits: {
            fieldSize: 10 * 1024 * 1024,
            // fileSize: 10 * 1024 * 1024
        }, // 10MB 파일 크기 제한
    }))
    @UseGuards(ManagerGuard)
    async createGoods(
        @UploadedFile() file: Express.Multer.File,
        @Body() goodsData: Omit<IGoodsCreate, 'imageURI' | "countAll"> & {
            countAll?: string;
        }
    ): Promise<{ success: boolean; data: { id: number } }> {
        const imageURI = `/uploads/${file.filename}`;
        Logger.log(file);

        return await this.rentalService.createGoods({
            ...goodsData,
            imageURI,
            countAll: parseInt(goodsData.countAll, 10)
        });
    }

    // 모든 물품 목록 조회
    @Get('goods/list')
    async getGoodsList(): Promise<IGoods[]> {
        return await this.rentalService.getGoodsList();
    }

    // 특정 물품 조회
    @Get('goods/:id')
    async getGoodsById(
        @Param('id', ParseIntPipe) id: number
    ): Promise<IGoods> {
        return await this.rentalService.getGoodsById(id);
    }

    // 물품 정보 수정
    @Put('goods/:id')
    @UseInterceptors(FileInterceptor('file', { storage: publicStorage, }))
    @UseGuards(ManagerGuard)
    async updateGoods(
        @Param('id', ParseIntPipe) id: number,
        @UploadedFile() file: Express.Multer.File,
        @Body() updates: Omit<IGoodsUpdate, "countNow" | "countAll"> & {
            countAll?: string;
        },
    ): Promise<ISuccessResponse> {
        if (file) {
            const imageURI = `/uploads/${file.filename}`;
            updates.imageURI = imageURI;
        }
        const countAll = updates.countAll === undefined
            ? undefined
            : Number.parseInt(updates.countAll, 10);
        return await this.rentalService.updateGoods(id, {
            ...updates,
            countAll,
        });
    }

    // 물품 삭제
    @Delete('goods/:id')
    @UseGuards(ManagerGuard)
    async deleteGoods(
        @Param('id', ParseIntPipe) id: number
    ): Promise<ISuccessResponse> {
        return await this.rentalService.deleteGoods(id);
    }

    // 물품 가용성 확인
    @Post('goods/check-availability')
    @UseGuards(MemberGuard)
    async checkGoodsAvailability(
        @Body() checkData: IGoodsAvailabilityCheck
    ): Promise<{ available: boolean }> {
        const available = await this.rentalService['rentalPublicService'].checkGoodsAvailability(checkData);
        return { available };
    }
}
